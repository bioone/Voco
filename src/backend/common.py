"""Paths, input checks and output bookkeeping shared by the audio services."""

from __future__ import annotations

import csv
import importlib.metadata
import importlib.util
import json
import math
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import re
import sys
import time
from typing import Any, Callable, Iterator
from uuid import uuid4

PROJECT_ROOT = Path(os.environ.get("QWEN_STUDIO_PROJECT_ROOT") or Path(__file__).resolve().parents[2]).expanduser().resolve()
Progress = Callable[[str], None]
MODEL_NAMES = {
    "tts": "Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "asr": "GLM-ASR-Nano-2512",
}
CSV_FIELDS = [
    "id", "name", "category", "gender", "age", "language", "audio_file",
    "prompt_file", "text_file", "metadata_file", "duration_seconds", "sample_rate",
    "text", "instruct", "created_at",
]


class BackendError(RuntimeError):
    """An actionable validation or runtime error that is safe to display."""


def payload_value(payload: dict[str, Any], camel: str, snake: str, default: Any = None) -> Any:
    return payload.get(camel, payload.get(snake, default))


def required_text(payload: dict[str, Any], key: str, limit: int) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise BackendError(f"{key} 不能为空。")
    if len(value) > limit:
        raise BackendError(f"{key} 最多支持 {limit} 个字符，请分成较短的任务。")
    return value


def resolve_path(value: str | Path, root: Path = PROJECT_ROOT) -> Path:
    path = Path(value).expanduser()
    return (path if path.is_absolute() else root / path).resolve()


def model_path(payload: dict[str, Any], kind: str, root: Path = PROJECT_ROOT) -> Path:
    value = payload_value(payload, "modelPath", "model_path")
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise BackendError("模型路径必须是本地目录。")
    path = resolve_path(value or Path("model") / MODEL_NAMES[kind], root)
    if not path.is_dir() or not (path / "config.json").is_file():
        raise BackendError(f"本地模型目录无效：{path}。请在设置中选择完整的 {MODEL_NAMES[kind]} 目录。")
    try:
        config = json.loads((path / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BackendError(f"无法读取模型配置：{path / 'config.json'}") from exc
    if kind == "tts" and config.get("tts_model_type") != "voice_design":
        raise BackendError("语音设计必须使用 Qwen3-TTS VoiceDesign 模型。")
    if kind == "asr" and config.get("model_type") != "glmasr":
        raise BackendError("当前识别功能需要 GLM-ASR-Nano-2512 模型。")
    return path


def offline_mode() -> None:
    """Set before importing HuggingFace: even nested tokenizer loads stay local."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def cuda_runtime(payload: dict[str, Any], path: Path) -> tuple[Any, int]:
    try:
        import torch
    except ImportError as exc:
        raise BackendError("当前 Python 环境缺少 torch。请在设置中选择项目对应的 CUDA 虚拟环境。") from exc
    if not torch.cuda.is_available():
        raise BackendError("未检测到可用 CUDA GPU。请检查 NVIDIA 驱动，并选择带 CUDA 的 Python 环境。")
    raw_index = payload_value(payload, "gpuIndex", "gpu_index", "0")
    if isinstance(raw_index, bool) or not re.fullmatch(r"\d+", str(raw_index)):
        raise BackendError("GPU 编号必须是非负整数。")
    index = int(raw_index)
    if index >= torch.cuda.device_count():
        raise BackendError(f"GPU {index} 不存在；可用 GPU 数量为 {torch.cuda.device_count()}。")
    free, _ = torch.cuda.mem_get_info(index)
    # Model tensors need at least their stored size plus a modest workspace.
    weight_bytes = sum(p.stat().st_size for p in path.glob("*.safetensors"))
    minimum = max(2 * 1024**3, weight_bytes + 512 * 1024**2)
    if free < minimum:
        raise BackendError(
            f"GPU {index} 可用显存 {free / 1024**3:.1f} GB，低于加载预检所需 {minimum / 1024**3:.1f} GB。"
            "请关闭占用显存的程序后重试。"
        )
    torch.cuda.set_device(index)
    return torch, index


def create_job_directory(payload: dict[str, Any], kind: str, root: Path = PROJECT_ROOT) -> tuple[str, Path]:
    job_id = payload_value(payload, "jobId", "job_id") or (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "_" + uuid4().hex[:16]
    )
    if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", job_id):
        raise BackendError("任务编号包含不支持的字符。")
    resolved_root = root.resolve()
    expected_outputs = resolved_root / "outputs"
    expected_parent = expected_outputs / kind
    # Refuse junctions/symlinks that would redirect output into user data or weights.
    if expected_outputs.resolve() != expected_outputs or expected_parent.resolve() != expected_parent:
        raise BackendError("outputs 或任务分类目录被重定向，拒绝写入。请选择项目内的普通输出目录。")
    directory = (expected_parent / job_id).resolve()
    if directory.parent != expected_parent:
        raise BackendError("任务目录被重定向，拒绝写入，以保护项目与模型文件。")
    supplied = payload_value(payload, "outputDir", "output_dir")
    if supplied is not None and resolve_path(supplied, root) != directory:
        raise BackendError("任务输出目录必须位于项目 outputs 下的对应独立任务目录。")
    directory.parent.mkdir(parents=True, exist_ok=True)
    try:
        directory.mkdir()
    except FileExistsError as exc:
        raise BackendError(f"任务输出已存在：{directory}。请创建新任务，已有结果不会被覆盖。") from exc
    return job_id, directory


def write_json(path: Path, data: dict[str, Any]) -> None:
    with path.open("x", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")


@contextmanager
def csv_lock(base: Path) -> Iterator[None]:
    lock = base / ".voice_library.lock"
    deadline = time.monotonic() + 10
    while True:
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(descriptor)
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise BackendError("声音库索引正在写入或存在未释放的锁。请等待其他任务完成后重试。")
            time.sleep(0.1)
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def append_voice(base: Path, row: dict[str, Any]) -> None:
    index = base / "voice_library.csv"
    with csv_lock(base):
        has_header = index.exists() and index.stat().st_size > 0
        if has_header:
            with index.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if reader.fieldnames != CSV_FIELDS:
                    raise BackendError(f"声音库索引格式不兼容，已保留原文件：{index}")
                if any(record.get("id") == row["id"] for record in reader):
                    raise BackendError(f"声音编号已存在：{row['id']}；已有记录不会被覆盖。")
        with index.open("a", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
            if not has_header:
                writer.writeheader()
            writer.writerow(row)


def dependency_status(module: str, distribution: str | None = None) -> dict[str, Any]:
    try:
        available = importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        available = False
    try:
        version = importlib.metadata.version(distribution or module)
    except importlib.metadata.PackageNotFoundError:
        version = None
    return {"available": available, "version": version}


def health(payload: dict[str, Any], root: Path = PROJECT_ROOT) -> dict[str, Any]:
    dependencies = {name: dependency_status(name, "qwen-tts" if name == "qwen_tts" else None)
                    for name in ("torch", "soundfile", "numpy", "scipy", "qwen_tts", "transformers", "accelerate")}
    issues: list[str] = []
    cuda: dict[str, Any] = {"available": False, "deviceName": None, "freeMemoryMB": 0, "totalMemoryMB": 0}
    offline_mode()
    if dependencies["torch"]["available"]:
        try:
            import torch
            if torch.cuda.is_available():
                index = int(payload_value(payload, "gpuIndex", "gpu_index", "0"))
                free, total = torch.cuda.mem_get_info(index)
                cuda = {"available": True, "deviceName": torch.cuda.get_device_name(index),
                        "freeMemoryMB": round(free / 1024**2), "totalMemoryMB": round(total / 1024**2),
                        "deviceCount": torch.cuda.device_count(), "gpuIndex": index}
            else:
                issues.append("当前环境无法使用 CUDA GPU。")
        except Exception as exc:
            issues.append(f"CUDA 检查失败：{exc}")
    else:
        issues.append("当前 Python 环境未安装 torch。")
    models: dict[str, Any] = {}
    kind = payload.get("kind")
    for candidate in MODEL_NAMES:
        selected = payload if candidate == kind else {}
        value = payload_value(selected, "modelPath", "model_path")
        path = resolve_path(value or Path("model") / MODEL_NAMES[candidate], root)
        try:
            model_path(selected, candidate, root)
            exists = True
        except BackendError as exc:
            exists = False
            if candidate == kind:
                issues.append(str(exc))
        models[candidate] = {"path": str(path), "exists": exists}
    shared = cuda["available"] and all(dependencies[name]["available"]
                                          for name in ("torch", "soundfile", "numpy", "transformers", "accelerate"))
    glm_available = False
    if dependencies["transformers"]["available"]:
        try:
            glm_available = importlib.util.find_spec("transformers.models.glmasr") is not None
        except (ImportError, ValueError):
            pass
    capabilities = {
        "tts": bool(shared and dependencies["qwen_tts"]["available"] and models["tts"]["exists"]),
        "asr": bool(shared and dependencies["scipy"]["available"] and glm_available and models["asr"]["exists"]),
    }
    if kind in MODEL_NAMES:
        required = ["torch", "soundfile", "numpy", "transformers", "accelerate"]
        required += ["qwen_tts"] if kind == "tts" else ["scipy"]
        missing = [name for name in required if not dependencies[name]["available"]]
        if missing:
            issues.append("当前环境缺少：" + "、".join(missing) + "。请选择对应虚拟环境。")
        if kind == "asr" and not glm_available:
            issues.append("当前 transformers 不支持 GLM-ASR，请选择项目 .venv-asr 环境。")
    return {"python": sys.executable, "version": sys.version.split()[0], "kind": kind,
            "cuda": cuda, "dependencies": dependencies, "models": models,
            "capabilities": capabilities, "ready": bool(capabilities.get(kind, False)), "issues": issues}


def library_path(base: Path, value: Any) -> Path | None:
    """Treat CSV paths as untrusted; never expose files outside a library."""
    if not isinstance(value, str) or not value:
        return None
    path = (base / value).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        return None
    return path


def voices(root: Path = PROJECT_ROOT) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    warnings: list[str] = []
    for base in (root / "voice_design", root / "outputs" / "tts"):
        index = base / "voice_library.csv"
        if not index.is_file():
            continue
        try:
            with index.open("r", encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    audio = library_path(base, row.get("audio_file"))
                    prompt = library_path(base, row.get("prompt_file"))
                    text = library_path(base, row.get("text_file"))
                    if not audio or not prompt or not text or not row.get("id"):
                        warnings.append(f"声音 {row.get('id', '?')} 缺少音频、文本或提示词，已跳过。")
                        continue
                    try:
                        duration = float(row.get("duration_seconds") or 0)
                    except (TypeError, ValueError):
                        duration = 0
                    if not math.isfinite(duration):
                        duration = 0
                    metadata = library_path(base, row.get("metadata_file"))
                    results.append({"id": row["id"], "name": row.get("name") or row["id"],
                                    "category": row.get("category") or "我的声音", "gender": row.get("gender", ""),
                                    "age": row.get("age", ""), "language": row.get("language") or "Chinese",
                                    "audioPath": str(audio), "promptPath": str(prompt), "textPath": str(text),
                                    "metadataPath": str(metadata) if metadata else None,
                                    "instruct": prompt.read_text(encoding="utf-8").strip(),
                                    "text": text.read_text(encoding="utf-8").strip(), "durationSeconds": duration})
        except (OSError, UnicodeError, csv.Error) as exc:
            warnings.append(f"无法完整读取声音库 {index}：{exc}")
    return {"voices": results, "warnings": warnings}
