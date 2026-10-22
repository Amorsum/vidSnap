"""不导入真实 faster-whisper：验证真实 Python 协议与转换文件生命周期。"""
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from whisper_audio import prepared_audio


class Utf8Buffer(io.StringIO):
    def reconfigure(self, **_):
        pass


class FakeModel:
    fail = False
    def __init__(self, *_, **__):
        pass

    def transcribe(self, *_args, **_kwargs):
        def segments():
            if FakeModel.fail:
                raise RuntimeError("fixture inference failure")
            yield types.SimpleNamespace(start=0, end=1.2, text=" 中文🚀 ")
        return segments(), types.SimpleNamespace(language="ja")


class WhisperPythonTests(unittest.TestCase):
    def setUp(self):
        FakeModel.fail = False
        self.fake_module = types.SimpleNamespace(WhisperModel=FakeModel)

    def test_01_conversion_success_checks_returncode_and_cleans_after_use(self):
        with patch.object(subprocess, "run") as run:
            with prepared_audio("fixture.mp4") as output:
                self.assertTrue(Path(output).exists())
                self.assertEqual(run.call_args.kwargs["check"], True)
                self.assertEqual(run.call_args.kwargs["timeout"], 60)
                self.assertIn("file,pipe", run.call_args.args[0])
            self.assertFalse(Path(output).exists())

    def test_02_conversion_failure_and_timeout_remove_partial_file(self):
        for error in [subprocess.CalledProcessError(1, "ffmpeg"), subprocess.TimeoutExpired("ffmpeg", 60)]:
            files = []
            def fail(command, **_):
                files.append(command[-1])
                raise error
            with patch.object(subprocess, "run", side_effect=fail), self.assertRaises(type(error)):
                with prepared_audio("fixture.mp4"):
                    self.fail("转换失败后不应继续推理")
            self.assertTrue(files)
            self.assertFalse(Path(files[0]).exists())

    def test_03_inference_iteration_failure_cleans_both_entrypoints(self):
        for script in ["whisper_server.py", "whisper_asr.py"]:
            with patch.dict(sys.modules, {"faster_whisper": self.fake_module}):
                module = runpy.run_path(str(SCRIPTS / script))
            files = []
            def convert(command, **_):
                files.append(command[-1])
            FakeModel.fail = True
            with patch.object(subprocess, "run", side_effect=convert), self.assertRaises(RuntimeError):
                module["transcribe"]("fixture.mp4", "tiny", "ja")
            self.assertFalse(Path(files[0]).exists())

    def test_04_protocol_ready_request_ids_progress_unicode_and_reuse(self):
        requests = [{"request_id": "first", "audio_path": "fixture", "model": "tiny"},
                    {"request_id": "second", "audio_path": "fixture", "language": "ja"}, {"action": "shutdown"}]
        with patch.dict(sys.modules, {"faster_whisper": self.fake_module}):
            module = runpy.run_path(str(SCRIPTS / "whisper_server.py"))
        output = Utf8Buffer()
        with patch.object(sys, "stdin", Utf8Buffer("\n".join(json.dumps(item) for item in requests))), patch.object(sys, "stdout", output), patch.object(sys, "stderr", Utf8Buffer()), patch.object(sys, "argv", ["whisper_server.py", "medium"]), patch.object(subprocess, "run"):
            module["main"]()
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[0], {"type": "ready", "protocol": 1})
        for request_id in ["first", "second"]:
            own = [item for item in messages if item.get("request_id") == request_id]
            self.assertEqual([item["type"] for item in own], ["progress", "progress", "result"])
            self.assertEqual(own[-1]["text"], "中文🚀")
            self.assertEqual(own[-1]["language"], "ja")

    def test_05_error_keeps_id_and_server_continues(self):
        with patch.dict(sys.modules, {"faster_whisper": self.fake_module}):
            module = runpy.run_path(str(SCRIPTS / "whisper_server.py"))
        output = Utf8Buffer()
        requests = [{"request_id": "failed", "audio_path": "fixture"}, {"action": "shutdown"}]
        FakeModel.fail = True
        with patch.object(sys, "stdin", Utf8Buffer("\n".join(json.dumps(item) for item in requests))), patch.object(sys, "stdout", output), patch.object(sys, "stderr", Utf8Buffer()), patch.object(sys, "argv", ["whisper_server.py"]), patch.object(subprocess, "run"):
            module["main"]()
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[-1], {"type": "error", "request_id": "failed", "error": "本地转写失败"})

    def test_06_single_script_json_and_failure_exit(self):
        for fail in [False, True]:
            FakeModel.fail = fail
            output = Utf8Buffer()
            with patch.dict(sys.modules, {"faster_whisper": self.fake_module}), patch.object(sys, "stdout", output), patch.object(sys, "stderr", Utf8Buffer()), patch.object(sys, "argv", ["whisper_asr.py", "fixture", "tiny", "ja"]), patch.object(subprocess, "run"):
                if fail:
                    with self.assertRaises(SystemExit) as result:
                        runpy.run_path(str(SCRIPTS / "whisper_asr.py"), run_name="__main__")
                    self.assertEqual(result.exception.code, 1)
                else:
                    runpy.run_path(str(SCRIPTS / "whisper_asr.py"), run_name="__main__")
            value = json.loads(output.getvalue())
            self.assertEqual(value["error"], "本地转写失败") if fail else self.assertEqual(value["text"], "中文🚀")


if __name__ == "__main__":
    unittest.main()
