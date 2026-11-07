"""Read-only audio preparation and segmented GLM-ASR transcription."""

from __future__ import annotations

from datetime import datetime, timezone
from math import gcd
from pathlib import Path
import time
from typing import Any

from src.backend.common import (
    BackendError, Progress, PROJECT_ROOT, create_job_directory, cuda_runtime,
    model_path, offline_mode, payload_value, resolve_path, write_json,
)

TARGET_RATE = 16000
SEGMENT_SECONDS = 30
MAX_AUDIO_SECONDS = 7200
MAX_DECODED_BYTES = 512 * 1024**2
MAX_NEW_TOKENS = 2048


def prepare_audio(path: Path) -> tuple[Any, int, float]:
    try:
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly
    except ImportError as exc:
        raise BackendError("识别环境缺少 numpy、soundfile 或 scipy，请选择项目 .venv-asr 环境。") from exc
    try:
        info = sf.info(str(path))
        if info.samplerate <= 0 or info.frames <= 0 or info.duration <= 0:
            raise BackendError("音频没有有效采样或时长。")
        if info.duration > MAX_AUDIO_SECONDS:
            raise BackendError("单次识别支持最多 2 小时音频，请分割文件后识别。")
        if info.frames * info.channels * 4 > MAX_DECODED_BYTES:
            raise BackendError("音频解码后超过 512 MB。请分割为较短片段，或先转换为 16 kHz 单声道 WAV。")
        audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except (OSError, RuntimeError) as exc:
        if isinstance(exc, BackendError):
            raise
        raise BackendError("音频无法读取，请使用有效的 WAV、FLAC 或 OGG 文件。") from exc
    if not audio.size or not np.isfinite(audio).all():
        raise BackendError("音频包含空数据或无效采样。")
    audio = audio.mean(axis=1)
    if float(np.max(np.abs(audio))) <= 1e-8:
        raise BackendError("所选音频为静音，请选择包含语音的音频。")
    if sample_rate != TARGET_RATE:
        divisor = gcd(sample_rate, TARGET_RATE)
        audio = resample_poly(audio, TARGET_RATE // divisor, sample_rate // divisor).astype(np.float32)
    return np.ascontiguousarray(audio), sample_rate, info.duration


def load_model(path: Path, torch: Any, gpu_index: int) -> tuple[Any, Any]:
    offline_mode()
    try:
        from transformers import AutoProcessor, GlmAsrForConditionalGeneration
    except ImportError as exc:
        raise BackendError("当前 transformers 不支持 GLM-ASR，请在设置中选择项目 .venv-asr 的 Python。") from exc
    processor = AutoProcessor.from_pretrained(str(path), local_files_only=True, trust_remote_code=False)
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model = GlmAsrForConditionalGeneration.from_pretrained(
        str(path), dtype=dtype, device_map=f"cuda:{gpu_index}",
        local_files_only=True, trust_remote_code=False, attn_implementation="sdpa",
    )
    model.eval()
    return processor, model


def transcribe(payload: dict[str, Any], progress: Progress, root: Path = PROJECT_ROOT) -> dict[str, Any]:
    started = time.monotonic()
    raw_audio = payload_value(payload, "audioPath", "audio_path", payload.get("inputPath"))
    if not isinstance(raw_audio, str) or not raw_audio.strip():
        raise BackendError("请先选择要识别的音频文件。")
    audio_path = resolve_path(raw_audio, root)
    if not audio_path.is_file():
        raise BackendError(f"音频文件不存在：{audio_path}")
    if audio_path.suffix.lower() not in {".wav", ".flac", ".ogg"}:
        raise BackendError("当前支持 WAV、FLAC、OGG 音频，请先将其他格式转换为其中一种。")
    path = model_path(payload, "asr", root)
    progress("正在读取音频，转换为 16 kHz 单声道…")
    audio, original_rate, duration = prepare_audio(audio_path)
    offline_mode()
    torch, gpu_index = cuda_runtime(payload, path)
    job_id, directory = create_job_directory(payload, "asr", root)
    progress("正在加载本地 GLM-ASR-Nano-2512 模型…")
    try:
        processor, model = load_model(path, torch, gpu_index)
        segment_size = TARGET_RATE * SEGMENT_SECONDS
        segment_count = (len(audio) + segment_size - 1) // segment_size
        segments: list[dict[str, Any]] = []
        warnings: list[str] = []
        for index, start in enumerate(range(0, len(audio), segment_size)):
            chunk = audio[start:start + segment_size]
            progress(f"正在识别第 {index + 1}/{segment_count} 段（每段最多 {SEGMENT_SECONDS} 秒）…")
            with torch.inference_mode():
                inputs = processor.apply_transcription_request(chunk)
                inputs = inputs.to(model.device, dtype=model.dtype)
                outputs = model.generate(**inputs, do_sample=False, max_new_tokens=MAX_NEW_TOKENS)
                generated = outputs[:, inputs.input_ids.shape[1]:]
                if generated.shape[1] >= MAX_NEW_TOKENS:
                    raise BackendError(f"第 {index + 1} 段识别达到输出长度上限，可能存在截断。请缩短音频片段后重试。")
                decoded = processor.batch_decode(generated, skip_special_tokens=True)
            if not decoded or not isinstance(decoded[0], str):
                raise BackendError(f"第 {index + 1} 段未返回有效识别文本。")
            text = decoded[0].strip()
            if not text:
                warning = f"第 {index + 1} 段未识别到文字，请检查该时间段是否有语音。"
                warnings.append(warning)
                progress(warning)
            segments.append({"startSeconds": round(start / TARGET_RATE, 3),
                             "endSeconds": round(min((start + len(chunk)) / TARGET_RATE, duration), 3), "text": text})
        text = "\n".join(segment["text"] for segment in segments if segment["text"]).strip()
        if not text:
            raise BackendError("模型未识别到语音文字。请确认音频中有人声且音量清晰。")
        text_path = directory / "transcript.txt"
        metadata_path = directory / "metadata.json"
        normalized_path = directory / "audio.wav"
        import soundfile as sf
        sf.write(str(normalized_path), audio, TARGET_RATE, subtype="PCM_16")
        normalized_info = sf.info(str(normalized_path))
        if normalized_info.samplerate != TARGET_RATE or normalized_info.frames <= 0 or normalized_info.duration <= 0:
            raise BackendError("识别音频副本验证失败，原始文件已保留。")
        text_path.write_text(text, encoding="utf-8")
        result = {"id": job_id, "name": audio_path.stem, "audioPath": str(normalized_path),
                  "inputAudioPath": str(audio_path), "text": text,
                  "textPath": str(text_path), "metadataPath": str(metadata_path),
                  "durationSeconds": round(duration, 4), "sampleRate": TARGET_RATE,
                  "originalSampleRate": original_rate, "segments": segments, "warnings": warnings, "modelPath": str(path),
                  "elapsedSeconds": round(time.monotonic() - started, 3),
                  "createdAt": datetime.now(timezone.utc).isoformat()}
        write_json(metadata_path, result)
        progress("识别完成，文字与分段时间记录已保存。")
        return result
    except torch.cuda.OutOfMemoryError as exc:
        raise BackendError("语音识别显存不足。请关闭其他 GPU 程序后重试，原始音频不会被修改。") from exc
