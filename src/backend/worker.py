"""Run one local operation: JSON request on stdin, JSON-line events on stdout."""

from __future__ import annotations

from contextlib import redirect_stdout
import json
import sys
from typing import Any, TextIO

from src.backend.common import BackendError, health, offline_mode, voices

MAX_REQUEST_BYTES = 1024 * 1024


def dispatch(payload: dict[str, Any], progress: Any) -> dict[str, Any]:
    operation = payload.get("operation")
    if operation == "health":
        return health(payload)
    if operation == "voices":
        return voices()
    if operation == "tts":
        from src.tts.service import synthesize
        return synthesize(payload, progress)
    if operation == "asr":
        from src.asr.service import transcribe
        return transcribe(payload, progress)
    raise BackendError("不支持的任务类型。")


def run(input_stream: TextIO, output_stream: TextIO, error_stream: TextIO) -> int:
    def emit(event: dict[str, Any]) -> None:
        output_stream.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        output_stream.flush()

    def progress(message: str) -> None:
        emit({"type": "progress", "message": message})

    try:
        line = input_stream.readline(MAX_REQUEST_BYTES + 1)
        if not line or len(line.encode("utf-8")) > MAX_REQUEST_BYTES:
            raise BackendError("任务请求为空或超过 1 MB。")
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BackendError("任务请求不是有效 JSON。") from exc
        if not isinstance(payload, dict):
            raise BackendError("任务请求必须是 JSON 对象。")
        offline_mode()
        # Third-party libraries print startup notices. Keep the protocol clean.
        with redirect_stdout(error_stream):
            result = dispatch(payload, progress)
        emit({"type": "result", "result": result})
        return 0
    except Exception as exc:
        message = str(exc) or type(exc).__name__
        emit({"type": "error", "message": message})
        return 1


def main() -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    return run(sys.stdin, sys.stdout, sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
