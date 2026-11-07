"""Packaged worker entry point; the packager copies this beside bundled src/."""

from __future__ import annotations

from pathlib import Path
import sys


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from src.backend.worker import main as worker_main

    return worker_main()


if __name__ == "__main__":
    raise SystemExit(main())
