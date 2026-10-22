"""只读运行环境检查。默认不联网、不加载模型、不读取 cookies 内容。"""
import argparse
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def check(identifier, status, message, **details):
    return {"id": identifier, "status": status, "message": message, "details": details}


def tool_check(name, args):
    if not shutil.which(name):
        return check(name, "fail", "未找到可执行文件")
    try:
        result = subprocess.run([name, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=8)
        if result.returncode:
            return check(name, "fail", "版本命令返回非零状态", exit_code=result.returncode)
        # 只保留版本首行，不能把下载器调试日志或本机路径纳入报告。
        first_line = result.stdout.splitlines()[0] if result.stdout.splitlines() else ""
        return check(name, "pass", "可执行", version=first_line[:160])
    except subprocess.TimeoutExpired:
        return check(name, "fail", "版本查询超时")
    except OSError:
        return check(name, "fail", "可执行文件无法启动")


def setup_vendor():
    vendor = ROOT / "scripts" / "_vendor"
    if vendor.is_dir():
        sys.path.insert(0, str(vendor))
    handles = []
    candidates = [vendor / "ctranslate2", Path.home() / "AppData/Roaming/Python/Python312/site-packages/nvidia/cublas/bin",
                  Path.home() / "AppData/Roaming/Python/Python312/site-packages/nvidia/cuda_nvrtc/bin"]
    if hasattr(os, "add_dll_directory"):
        for directory in candidates:
            if directory.is_dir():
                handles.append(os.add_dll_directory(str(directory)))
                os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")
    return handles


def package_check(module, optional=False):
    try:
        loaded = importlib.import_module(module)
        vendor_root = str(ROOT / "scripts" / "_vendor")
        source = "vendor" if str(getattr(loaded, "__file__", "")).startswith(vendor_root + os.sep) else "python"
        version = getattr(loaded, "__version__", None)
        if not version:
            try:
                version = importlib.metadata.version(module.replace("_", "-"))
            except importlib.metadata.PackageNotFoundError:
                version = "unknown"
        return check(module, "pass", "模块可导入，推理或浏览器能力需另验收", source=source, version=str(version))
    except Exception as error:
        return check(module, "warn" if optional else "fail", "模块无法导入，请核对当前 Python 与 DLL 依赖", error_type=type(error).__name__)


def cached_models():
    hub = Path(os.environ.get("HF_HUB_CACHE") or os.environ.get("HUGGINGFACE_HUB_CACHE")
               or str(Path(os.environ.get("HF_HOME") or str(Path.home() / ".cache/huggingface")) / "hub"))
    found = []
    for name in ["tiny", "base", "small", "medium", "large-v3"]:
        snapshots = hub / ("models--Systran--faster-whisper-" + name) / "snapshots"
        if not snapshots.is_dir():
            continue
        for snapshot in snapshots.iterdir():
            if all((snapshot / filename).is_file() for filename in ["model.bin", "config.json", "tokenizer.json"]):
                found.append(name)
                break
    return found


def proxy_check(connect=False):
    from urllib.parse import urlsplit
    value = os.environ.get("MEDIA_UPSTREAM_PROXY", "")
    if not value:
        return check("media_proxy", "warn", "媒体使用公网直连；不会自动使用系统代理", configured=False)
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "http" or not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError()
        port = parsed.port or 80
        if connect:
            with socket.create_connection((parsed.hostname, port), timeout=3):
                pass
        return check("media_proxy", "pass", "代理端口可连接；尚未证明平台可用" if connect else "代理格式合法，默认不连接端口", configured=True, port=port, port_verified=connect)
    except (ValueError, OSError):
        return check("media_proxy", "fail", "上游代理格式不合法或端口无法连接", configured=True)


def network_checks():
    from media_network import request_url
    results = []
    for scope, target in [("youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"), ("douyin", "https://www.douyin.com/")]:
        try:
            with request_url(target, scope) as response:
                code = response.status
            status = "pass" if code == 200 else "warn"
            results.append(check(scope + "_network", status, "受控出站收到 HTTP 响应；尚未验证视频解析或下载", http_status=code))
        except Exception as error:
            results.append(check(scope + "_network", "fail", "受控平台连接失败", error_type=type(error).__name__))
    return results


def probe(network=False):
    checks = [check("python", "pass", "当前解释器可运行", version=sys.version.split()[0])]
    checks.extend(tool_check(name, args) for name, args in [("yt-dlp", ["--ignore-config", "--no-plugin-dirs", "--version"]), ("ffmpeg", ["-version"]), ("ffprobe", ["-version"])])
    handles = setup_vendor()
    try:
        checks.extend([package_check("ctranslate2", optional=True), package_check("faster_whisper", optional=True), package_check("playwright", optional=True)])
        models = cached_models()
        checks.append(check("whisper_cache", "pass" if models else "warn", "仅检查缓存文件，不加载或下载模型", models=models))
    finally:
        for handle in handles:
            handle.close()
    checks.append(check("cookies", "pass" if (ROOT / "cookies.txt").is_file() else "warn", "仅检查项目 cookies.txt 是否存在，不读取内容或浏览器数据库", present=(ROOT / "cookies.txt").is_file()))
    checks.append(proxy_check(connect=network))
    if network:
        checks.extend(network_checks())
    else:
        checks.append(check("network", "skip", "默认不发出平台请求；使用 --network 显式启用"))
    return {"schema_version": 1, "checks": checks, "scope": "dependency_and_connectivity", "full_pipeline_verified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", action="store_true")
    options = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        report = probe(options.network)
        print(json.dumps(report, ensure_ascii=False))
        return 1 if any(item["status"] == "fail" for item in report["checks"]) else 0
    except Exception as error:
        print(json.dumps({"schema_version": 1, "checks": [check("probe", "fail", "环境检查未完成", error_type=type(error).__name__)], "scope": "dependency_and_connectivity", "full_pipeline_verified": False}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
