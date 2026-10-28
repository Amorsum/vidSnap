import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { detectPlatform, parseVideoUrl } from "./url-utils";

const execFileAsync = promisify(execFile);
const networkScript = path.join(process.cwd(), "scripts", "media_network.py");

/** Python 边界进程管理代理与下载器；子进程预算先到，外层留出清理时间。 */
export function runYtDlp(args: string[], timeout = 120000, cleanupMs = 10000) {
  const command = detectPlatform(args.at(-1) ?? "") === "bilibili" ? "yt-dlp-bilibili" : "yt-dlp";
  return execFileAsync("python", [networkScript, command, String(Math.ceil(timeout / 1000)), ...args], {
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

export function downloadPublicSubtitle(url: string, output: string, scope: "youtube" | "bilibili" = "youtube") {
  return execFileAsync("python", [networkScript, scope === "bilibili" ? "subtitle-bilibili" : "subtitle", url, output], {
    timeout: 45000, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
}

export async function resolveBilibiliUrl(url: string): Promise<string> {
  const parsed = parseVideoUrl(url);
  if (parsed?.platform !== "bilibili") throw new Error("Bilibili 视频链接无效");
  if (parsed.videoId) return parsed.url;
  const { stdout } = await execFileAsync("python", [networkScript, "resolve-bilibili", parsed.url], {
    timeout: 45000, maxBuffer: 16384, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  }).catch(() => { throw new Error("Bilibili 短链接解析失败"); });
  const resolved = parseVideoUrl(stdout.trim());
  if (resolved?.platform !== "bilibili" || !resolved.videoId) throw new Error("Bilibili 短链接未指向可分析的视频");
  return resolved.url;
}
