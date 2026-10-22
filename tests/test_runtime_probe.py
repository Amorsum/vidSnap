"""环境检查器回归：版本/依赖/缓存/代理/网络边界，不加载真实模型。"""
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import runtime_probe as probe
import media_network


class RuntimeProbeTests(unittest.TestCase):
    def test_01_tool_missing_timeout_and_nonzero_are_not_success(self):
        with patch.object(probe.shutil, "which", return_value=None):
            self.assertEqual(probe.tool_check("ffmpeg", ["-version"])["status"], "fail")
        for outcome in [probe.subprocess.TimeoutExpired("ffmpeg", 8), OSError("private path")]:
            with patch.object(probe.shutil, "which", return_value="fixture"), patch.object(probe.subprocess, "run", side_effect=outcome):
                result = probe.tool_check("ffmpeg", ["-version"])
                self.assertEqual(result["status"], "fail")
                self.assertNotIn("private", json.dumps(result))
        with patch.object(probe.shutil, "which", return_value="fixture"), patch.object(probe.subprocess, "run", return_value=types.SimpleNamespace(returncode=1)):
            self.assertEqual(probe.tool_check("ffmpeg", ["-version"])["status"], "fail")

    def test_02_version_only_first_line_not_debug_output(self):
        with patch.object(probe.shutil, "which", return_value="fixture"), patch.object(probe.subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stdout="ffmpeg version fixture\nprivate debug")):
            result = probe.tool_check("ffmpeg", ["-version"])
            self.assertEqual(result["details"]["version"], "ffmpeg version fixture")
            self.assertNotIn("private", json.dumps(result))

    def test_03_cached_model_requires_all_files_and_uses_configured_hub(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"HF_HUB_CACHE": directory}):
            snapshot = Path(directory) / "models--Systran--faster-whisper-tiny/snapshots/test"
            snapshot.mkdir(parents=True)
            (snapshot / "model.bin").write_bytes(b"fixture")
            self.assertEqual(probe.cached_models(), [])
            for name in ["config.json", "tokenizer.json"]:
                (snapshot / name).write_text("{}")
            self.assertEqual(probe.cached_models(), ["tiny"])

    def test_04_vendor_import_source_is_reported_and_optional_failure_warns(self):
        module = types.SimpleNamespace(__file__=str(probe.ROOT / "scripts/_vendor/faster_whisper/__init__.py"), __version__="fixture")
        with patch.object(probe.importlib, "import_module", return_value=module):
            self.assertEqual(probe.package_check("faster_whisper")["details"]["source"], "vendor")
        with patch.object(probe.importlib, "import_module", side_effect=ImportError("private token")):
            result = probe.package_check("faster_whisper", optional=True)
            self.assertEqual(result["status"], "warn")
            self.assertNotIn("private", json.dumps(result))

    def test_05_proxy_default_explicit_and_credentials_redaction(self):
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": ""}), patch.object(probe.socket, "create_connection") as connect:
            self.assertEqual(probe.proxy_check()["status"], "warn")
            connect.assert_not_called()
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": "http://test:secret@127.0.0.1:7890"}), patch.object(probe.socket, "create_connection"):
            result = probe.proxy_check(connect=True)
            self.assertEqual(result["status"], "pass")
            self.assertEqual(result["details"]["port"], 7890)
            self.assertNotIn("secret", json.dumps(result))
            self.assertNotIn("test:", json.dumps(result))
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": "http://127.0.0.1:7890"}), patch.object(probe.socket, "create_connection") as connect:
            self.assertFalse(probe.proxy_check()["details"]["port_verified"])
            connect.assert_not_called()
        with patch.dict(os.environ, {"MEDIA_UPSTREAM_PROXY": "file:///private/secret"}):
            self.assertEqual(probe.proxy_check()["status"], "fail")

    def test_06_http_200_is_only_connectivity_not_pipeline_success(self):
        response = types.SimpleNamespace(status=200)
        with patch.object(media_network, "request_url", return_value=Mock(__enter__=Mock(return_value=response), __exit__=Mock(return_value=False))):
            results = probe.network_checks()
        self.assertEqual([item["status"] for item in results], ["pass", "pass"])
        self.assertTrue(all("尚未验证" in item["message"] for item in results))
        with patch.object(media_network, "request_url", side_effect=media_network.NetworkPolicyError("private token")):
            results = probe.network_checks()
        self.assertEqual([item["status"] for item in results], ["fail", "fail"])
        self.assertNotIn("private", json.dumps(results))

    def test_07_default_probe_never_networks_and_never_claims_full_pipeline(self):
        with patch.object(probe, "tool_check", return_value=probe.check("tool", "pass", "fixture")), patch.object(probe, "setup_vendor", return_value=[]), patch.object(probe, "package_check", return_value=probe.check("package", "pass", "fixture")), patch.object(probe, "cached_models", return_value=[]), patch.object(probe, "proxy_check", return_value=probe.check("proxy", "warn", "fixture")), patch.object(probe, "network_checks") as network:
            report = probe.probe()
        network.assert_not_called()
        self.assertFalse(report["full_pipeline_verified"])
        self.assertEqual(report["schema_version"], 1)
        self.assertTrue(any(item["status"] == "skip" for item in report["checks"]))


if __name__ == "__main__":
    unittest.main()
