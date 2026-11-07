"""One local VoiceDesign synthesis job with complete, verified outputs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Any

from src.backend.common import (
    BackendError, Progress, PROJECT_ROOT, append_voice, create_job_directory,
    cuda_runtime, model_path, offline_mode, required_text, write_json,
)

LANGUAGES = {name.lower(): name for name in (
    "Chinese", "English", "Japanese", "Korean", "German", "French", "Russian",
    "Portuguese", "Spanish", "Italian", "Auto",
)}


def load_model(path: Path, torch: Any, gpu_index: int) -> Any:
    offline_mode()
    try:
        from qwen_tts import Qwen3TTSModel
    except ImportError as exc:
        raise BackendError("当前环境无法加载 qwen_tts，请在设置中选择 .venv-tts 的 Python。") from exc
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    return Qwen3TTSModel.from_pretrained(
        str(path), device_map=f"cuda:{gpu_index}", dtype=dtype,
        local_files_only=True, attn_implementation="sdpa",
    )


def synthesize(payload: dict[str, Any], progress: Progress, root: Path = PROJECT_ROOT) -> dict[str, Any]:
    started = time.monotonic()
    text = required_text(payload, "text", 6000)
    instruct = required_text(payload, "instruct", 3000)
    raw_language = payload.get("language", "Chinese")
    if not isinstance(raw_language, str) or raw_language.lower() not in LANGUAGES:
        raise BackendError("不支持的合成语言，请选择中文、英文、日文、韩文等模型支持的语言。")
    language = LANGUAGES[raw_language.lower()]
    name = payload.get("name") or "我的声音"
    if not isinstance(name, str) or len(name) > 200:
        raise BackendError("声音名称必须是 200 字符以内的文本。")
    path = model_path(payload, "tts", root)
    offline_mode()
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:
        raise BackendError("当前环境缺少 numpy 或 soundfile，请选择项目 .venv-tts 环境。") from exc
    torch, gpu_index = cuda_runtime(payload, path)
    job_id, directory = create_job_directory(payload, "tts", root)
    progress("正在加载本地 Qwen3-TTS VoiceDesign 模型…")
    try:
        model = load_model(path, torch, gpu_index)
        progress("正在合成语音，任务将使用 GPU；长文本可能需要几分钟…")
        with torch.inference_mode():
            waves, sample_rate = model.generate_voice_design(text=text, language=language, instruct=instruct)
        if not waves or not isinstance(sample_rate, int) or sample_rate <= 0:
            raise BackendError("模型未返回有效音频。请缩短文本或调整音色描述后重试。")
        audio = np.asarray(waves[0], dtype=np.float32)
        if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all() or float(np.max(np.abs(audio))) <= 1e-8:
            raise BackendError("模型返回了空音频、静音或无效采样，任务未被标记为成功。")
        audio_path = directory / "audio.wav"
        sf.write(str(audio_path), audio, sample_rate, subtype="PCM_16")
        info = sf.info(str(audio_path))
        if info.samplerate <= 0 or info.frames <= 0 or info.duration <= 0:
            raise BackendError("输出 WAV 验证失败，任务未被标记为成功。")
        text_path = directory / "text.txt"
        prompt_path = directory / "prompt.txt"
        metadata_path = directory / "metadata.json"
        text_path.write_text(text, encoding="utf-8")
        prompt_path.write_text(instruct, encoding="utf-8")
        result = {"id": job_id, "name": name, "audioPath": str(audio_path), "textPath": str(text_path),
                  "promptPath": str(prompt_path), "metadataPath": str(metadata_path),
                  "durationSeconds": round(info.duration, 4), "sampleRate": info.samplerate,
                  "language": language, "text": text, "instruct": instruct,
                  "elapsedSeconds": round(time.monotonic() - started, 3),
                  "modelPath": str(path), "createdAt": datetime.now(timezone.utc).isoformat()}
        write_json(metadata_path, result)
        append_voice(directory.parent, {
            "id": job_id, "name": name, "category": "我的声音", "gender": "", "age": "", "language": language,
            "audio_file": f"{job_id}/audio.wav", "prompt_file": f"{job_id}/prompt.txt", "text_file": f"{job_id}/text.txt",
            "metadata_file": f"{job_id}/metadata.json", "duration_seconds": result["durationSeconds"],
            "sample_rate": info.samplerate, "text": text, "instruct": instruct, "created_at": result["createdAt"],
        })
        progress("合成完成，WAV 与声音库元数据已验证并保存。")
        return result
    except torch.cuda.OutOfMemoryError as exc:
        raise BackendError("语音合成显存不足。请关闭其他 GPU 程序、缩短文本后重试；已保留现有声音。") from exc
