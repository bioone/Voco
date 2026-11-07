"""CPU-only protocol/output checks; model generation is deliberately mocked."""

from __future__ import annotations

import csv
from contextlib import nullcontext
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from src.asr import service as asr
from src.backend import common, worker
from src.tts import service as tts


def fake_torch() -> SimpleNamespace:
    class OutOfMemoryError(RuntimeError):
        pass
    return SimpleNamespace(inference_mode=nullcontext, cuda=SimpleNamespace(OutOfMemoryError=OutOfMemoryError))


class BackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for kind, name in common.MODEL_NAMES.items():
            directory = self.root / "model" / name
            directory.mkdir(parents=True)
            config = {"tts_model_type": "voice_design"} if kind == "tts" else {"model_type": "glmasr"}
            (directory / "config.json").write_text(json.dumps(config), encoding="utf-8")

    def write_audio(self, name: str = "input.wav", seconds: float = 1, sample_rate: int = 8000, stereo: bool = False) -> Path:
        import numpy as np
        import soundfile as sf
        samples = np.sin(np.arange(round(seconds * sample_rate)) * (2 * np.pi * 220 / sample_rate)).astype(np.float32) * 0.1
        if stereo:
            samples = np.column_stack((samples, samples))
        path = self.root / name
        sf.write(path, samples, sample_rate)
        return path

    def tts_job(self, payload: dict | None = None) -> dict:
        import numpy as np
        data = {"text": "你好。\n这是测试，保留原始文本。", "instruct": "年轻女声，温暖、低音，语速适中，清晰吐字，短停顿，讲述故事。", "name": "中文测试"}
        data.update(payload or {})
        model = SimpleNamespace(generate_voice_design=lambda **kwargs: ([np.sin(np.arange(2400) * .1).astype(np.float32) * .1], 24000))
        with patch.object(tts, "cuda_runtime", return_value=(fake_torch(), 0)), patch.object(tts, "load_model", return_value=model):
            return tts.synthesize(data, lambda message: None, self.root)

    def test_synthesis_complete_outputs_and_csv_preserve_existing_jobs(self) -> None:
        import soundfile as sf
        first = self.tts_job({"job_id": "first"})
        wave_before = Path(first["audioPath"]).read_bytes()
        second = self.tts_job({"job_id": "second", "text": "第二次。"})
        self.assertEqual(Path(first["audioPath"]).read_bytes(), wave_before)
        self.assertNotEqual(first["id"], second["id"])
        self.assertGreater(sf.info(first["audioPath"]).duration, 0)
        self.assertEqual(Path(first["textPath"]).read_text(encoding="utf-8"), first["text"])
        self.assertEqual(Path(first["promptPath"]).read_text(encoding="utf-8"), first["instruct"])
        metadata = json.loads(Path(first["metadataPath"]).read_text(encoding="utf-8"))
        self.assertEqual(metadata["sampleRate"], 24000)
        self.assertEqual(metadata["text"], first["text"])
        with (self.root / "outputs" / "tts" / "voice_library.csv").open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual([row["id"] for row in rows], ["first", "second"])
        self.assertEqual(rows[0]["text"], first["text"])
        self.assertEqual(rows[0]["instruct"], first["instruct"])
        library = common.voices(self.root)
        self.assertEqual(len(library["voices"]), 2)
        self.assertEqual(library["warnings"], [])

    def test_duplicate_job_never_overwrites_audio_or_index(self) -> None:
        result = self.tts_job({"job_id": "same"})
        index = self.root / "outputs" / "tts" / "voice_library.csv"
        before = index.read_bytes(), Path(result["audioPath"]).read_bytes()
        with self.assertRaisesRegex(common.BackendError, "不会被覆盖"):
            self.tts_job({"job_id": "same", "text": "不应写入的文本"})
        self.assertEqual(before, (index.read_bytes(), Path(result["audioPath"]).read_bytes()))

    def test_synthesis_empty_invalid_and_silent_model_outputs_fail(self) -> None:
        import numpy as np
        for index, wave in enumerate((np.array([]), np.zeros(100), np.array([float("nan")]))):
            with self.subTest(index=index):
                model = SimpleNamespace(generate_voice_design=lambda **kwargs: ([wave], 24000))
                with patch.object(tts, "cuda_runtime", return_value=(fake_torch(), 0)), patch.object(tts, "load_model", return_value=model):
                    with self.assertRaises(common.BackendError):
                        tts.synthesize({"text": "你好", "instruct": "温暖女声", "job_id": f"bad{index}"}, lambda msg: None, self.root)
        self.assertFalse((self.root / "outputs" / "tts" / "voice_library.csv").exists())

    def test_bad_inputs_are_rejected_before_model_loading(self) -> None:
        with patch.object(tts, "load_model") as loader:
            for payload in ({"text": " ", "instruct": "test"}, {"text": "x", "instruct": " "},
                            {"text": "x", "instruct": "test", "language": "unsupported"}):
                with self.assertRaises(common.BackendError):
                    tts.synthesize(payload, lambda msg: None, self.root)
            loader.assert_not_called()
        for payload in ({}, {"audio_path": "missing.wav"}, {"audio_path": str(self.write_audio("file.mp3"))}):
            with self.assertRaises(common.BackendError):
                asr.transcribe(payload, lambda msg: None, self.root)

    def test_model_kind_and_output_path_boundaries(self) -> None:
        wrong_model = self.root / "model" / common.MODEL_NAMES["asr"]
        with self.assertRaises(common.BackendError):
            common.model_path({"model_path": str(wrong_model)}, "tts", self.root)
        for payload in ({"job_id": "../outside"}, {"job_id": "safe", "output_dir": str(self.root / "elsewhere")}):
            with self.assertRaises(common.BackendError):
                common.create_job_directory(payload, "tts", self.root)
        self.assertFalse((self.root / "elsewhere").exists())

    def test_audio_preparation_is_mono_resampled_and_read_only(self) -> None:
        path = self.write_audio(seconds=1.5, sample_rate=8000, stereo=True)
        before = hashlib.sha256(path.read_bytes()).digest()
        audio, original_rate, duration = asr.prepare_audio(path)
        self.assertEqual(original_rate, 8000)
        self.assertEqual(len(audio), 24000)
        self.assertEqual(audio.ndim, 1)
        self.assertEqual(duration, 1.5)
        self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), before)

    def test_transcription_segments_cover_entire_input_and_store_metadata(self) -> None:
        path = self.write_audio(seconds=31, sample_rate=8000, stereo=True)
        before = path.read_bytes()
        seen: list[int] = []

        class Inputs(dict):
            input_ids = SimpleNamespace(shape=(1, 4))
            def to(self, *args, **kwargs):
                return self

        class Output:
            shape = (1, 10)
            def __getitem__(self, key):
                return self

        class Processor:
            def apply_transcription_request(self, chunk):
                seen.append(len(chunk))
                return Inputs()
            def batch_decode(self, *args, **kwargs):
                return [f"第{len(seen)}段识别文字"]

        model = SimpleNamespace(device="cuda:0", dtype="float16", generate=lambda **kwargs: Output())
        with patch.object(asr, "cuda_runtime", return_value=(fake_torch(), 0)), patch.object(asr, "load_model", return_value=(Processor(), model)):
            result = asr.transcribe({"audio_path": str(path), "job_id": "recognize"}, lambda msg: None, self.root)
        self.assertEqual(seen, [480000, 16000])
        self.assertEqual(result["segments"][0]["startSeconds"], 0)
        self.assertEqual(result["segments"][-1]["endSeconds"], 31)
        self.assertEqual(result["text"], "第1段识别文字\n第2段识别文字")
        self.assertEqual(Path(result["textPath"]).read_text(encoding="utf-8"), result["text"])
        self.assertEqual(json.loads(Path(result["metadataPath"]).read_text(encoding="utf-8"))["segments"], result["segments"])
        self.assertTrue(Path(result["audioPath"]).is_relative_to(self.root / "outputs" / "asr"))
        import soundfile as sf
        self.assertEqual(sf.info(result["audioPath"]).samplerate, 16000)
        self.assertEqual(result["inputAudioPath"], str(path))
        self.assertEqual(path.read_bytes(), before)

    def test_library_rejects_paths_outside_library_and_missing_assets(self) -> None:
        base = self.root / "voice_design"
        base.mkdir()
        (self.root / "private.wav").write_bytes(b"private")
        with (base / "voice_library.csv").open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["id", "audio_file", "prompt_file", "text_file"])
            writer.writeheader()
            writer.writerow({"id": "unsafe", "audio_file": "../private.wav", "prompt_file": "../private.wav", "text_file": "../private.wav"})
            writer.writerow({"id": "missing", "audio_file": "missing.wav"})
        result = common.voices(self.root)
        self.assertEqual(result["voices"], [])
        self.assertEqual(len(result["warnings"]), 2)

    def test_worker_emits_only_json_and_exactly_one_terminal_event(self) -> None:
        output, errors = io.StringIO(), io.StringIO()
        def operation(payload, progress):
            print("third-party startup output")
            progress("测试进度")
            return {"text": "你好"}
        with patch.object(worker, "dispatch", side_effect=operation):
            status = worker.run(io.StringIO('{"operation":"tts"}\n'), output, errors)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(status, 0)
        self.assertEqual([event["type"] for event in events], ["progress", "result"])
        self.assertEqual(events[-1]["result"], {"text": "你好"})
        self.assertIn("third-party startup output", errors.getvalue())

    def test_worker_bad_requests_and_dependency_failures_are_errors(self) -> None:
        for request in ("", "not json", "[]", '{"operation":"unknown"}'):
            output = io.StringIO()
            status = worker.run(io.StringIO(request), output, io.StringIO())
            self.assertEqual(status, 1)
            self.assertEqual([json.loads(line)["type"] for line in output.getvalue().splitlines()], ["error"])
        output = io.StringIO()
        with patch.object(worker, "dispatch", side_effect=ImportError("missing package")):
            status = worker.run(io.StringIO('{"operation":"tts"}'), output, io.StringIO())
        self.assertEqual(status, 1)
        self.assertIn("missing package", json.loads(output.getvalue())["message"])

    def test_cuda_missing_and_memory_insufficient_are_actionable(self) -> None:
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
        path = self.root / "model" / common.MODEL_NAMES["tts"]
        with patch.dict("sys.modules", {"torch": torch}):
            with self.assertRaisesRegex(common.BackendError, "CUDA"):
                common.cuda_runtime({}, path)
        torch.cuda = SimpleNamespace(is_available=lambda: True, device_count=lambda: 1, mem_get_info=lambda index: (128 * 1024**2, 12 * 1024**3))
        with patch.dict("sys.modules", {"torch": torch}):
            with self.assertRaisesRegex(common.BackendError, "关闭占用显存"):
                common.cuda_runtime({}, path)


if __name__ == "__main__":
    unittest.main()
