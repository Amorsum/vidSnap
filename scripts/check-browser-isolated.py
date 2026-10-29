"""在独立副本中构建并运行学习工作台浏览器检查。"""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TESTS = ("browser-notebook-backup.py", "browser-learning-progress.py", "browser-notebook-search.py")


def run(command, cwd, env):
    print("运行:", " ".join(map(str, command)), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main():
    if sys.argv[1:] not in ([], ["--fail-after-ready"]):
        raise SystemExit("参数仅支持 --fail-after-ready（验证异常清理）")
    env = os.environ.copy()
    for key in list(env):
        if key.endswith("_API_KEY") or key.upper().endswith("_PROXY") or key in ("ACCESS_CODE", "NODE_OPTIONS"):
            env.pop(key, None)
    env["NEXT_TELEMETRY_DISABLED"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode("utf-8").split("\0")
    temporary_root = ROOT / "tmp"
    temporary_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="vidsnap-browser-", dir=temporary_root) as tmp:
        workspace = Path(tmp) / "workspace"
        workspace.mkdir()
        for name in files:
            if not name:
                continue
            source = ROOT / name
            relative = Path(name)
            if relative.parts[0] in (".agents", ".codex", ".claude") or relative.name.startswith(".env") and relative.name != ".env.example" or relative.name in ("cookies.txt", "cloudflared-config.yml"):
                continue
            if source.is_file() and not source.is_symlink() and source.resolve().is_relative_to(ROOT):
                destination = workspace / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        modules = workspace / "node_modules"
        source_modules = (ROOT / "node_modules").resolve(strict=True)
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(modules), str(source_modules)], check=True, capture_output=True)
        else:
            modules.symlink_to(source_modules, target_is_directory=True)
        server = None
        try:
            run(["node", "node_modules/next/dist/bin/next", "build"], workspace, env)
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            base = f"http://127.0.0.1:{port}"
            server_env = env | {"VIDSNAP_TEST_MOCKS": "1", "NODE_OPTIONS": "--import=./tests/fixtures/mock-upstream.mjs"}
            with (Path(tmp) / "server.log").open("w", encoding="utf-8") as log:
                server = subprocess.Popen(["node", "node_modules/next/dist/bin/next", "start", "-p", str(port), "-H", "127.0.0.1"], cwd=workspace, env=server_env, stdout=log, stderr=subprocess.STDOUT)
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError("隔离服务提前退出，请检查依赖和端口")
                    try:
                        with urllib.request.urlopen(base, timeout=1) as response:
                            if response.headers.get("x-vidsnap-test-mocks") == "1":
                                break
                    except (OSError, urllib.error.URLError):
                        pass
                    time.sleep(0.2)
                else:
                    raise RuntimeError("隔离测试服务未就绪或缺少测试标识")
                print("隔离服务地址:", base, flush=True)
                if sys.argv[1:] == ["--fail-after-ready"]:
                    raise RuntimeError("测试用故障注入：服务就绪后退出")
                for test in TESTS:
                    run([sys.executable, "-B", f"tests/{test}", base], workspace, env)
        finally:
            if server is not None and server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
            if modules.is_symlink():
                modules.unlink()
            elif os.name == "nt" and os.path.isjunction(modules):
                os.rmdir(modules)
            else:
                raise RuntimeError("依赖链接状态异常，拒绝递归清理")
    print("隔离浏览器检查通过，测试服务和临时副本已清理。")


if __name__ == "__main__":
    main()
