import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const networkScript = path.join(process.cwd(), "scripts", "media_network.py");

/** Python 边界进程管理代理与下载器；子进程预算先到，外层留出清理时间。 */
export function runYtDlp(args: string[], timeout = 120000, cleanupMs = 10000) {
  return execFileAsync("python", [networkScript, "yt-dlp", String(Math.ceil(timeout / 1000)), ...args], {
    timeout: timeout + cleanupMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}

export function downloadPublicMedia(url: string, output: string) {
  return execFileAsync("python", [networkScript, "download", url, output], {
    timeout: 130000, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}

export function downloadPublicSubtitle(url: string, output: string) {
  return execFileAsync("python", [networkScript, "subtitle", url, output], {
    timeout: 45000, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}
