import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const execFileAsync = promisify(execFile);

const TEMP_DIR = path.join(os.tmpdir(), "vidsnap");
const LOCAL_YTDLP = path.join(process.cwd(), "bin", "yt-dlp");
const YT_DLP_PATH = existsSync(LOCAL_YTDLP) ? LOCAL_YTDLP : "yt-dlp";

// ─── 类型 ───

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

export interface ProcessResult {
  info: VideoInfo;
  audioPath: string;
}

// ─── 工具 ───

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ENV_COOKIES_FILE = path.join(os.tmpdir(), "vidsnap_bilibili_cookies.txt");

function ensureTempDir(): Promise<string> {
  return fs.mkdir(TEMP_DIR, { recursive: true }).then(() => TEMP_DIR);
}

function randomHex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function generateBuvid(): { buvid3: string; buvid4: string } {
  // buvid3 格式: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXXinfoc
  const uuid = `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
  return {
    buvid3: `${uuid}infoc`,
    buvid4: `${uuid.replace(/-/g, "")}-${Date.now()}`,
  };
}

async function writeEnvCookies(): Promise<string | null> {
  const cookieStr = process.env.BILIBILI_COOKIES;
  let content = cookieStr || "";

  // 确保包含 buvid3/buvid4 指纹 cookie（B站 412 的根本原因）
  if (!content.includes("buvid3")) {
    const { buvid3, buvid4 } = generateBuvid();
    const buvidLines = [
      `.bilibili.com\tTRUE\t/\tFALSE\t0\tbuvid3\t${buvid3}`,
      `.bilibili.com\tTRUE\t/\tFALSE\t0\tbuvid4\t${buvid4}`,
    ];
    content = content.trim() + "\n" + buvidLines.join("\n") + "\n";
  }

  if (content.length < 30) return null;
  await fs.writeFile(ENV_COOKIES_FILE, content);
  return ENV_COOKIES_FILE;
}

async function getCookieArgs(): Promise<string[]> {
  const cookiesFile = await writeEnvCookies();
  return cookiesFile ? ["--cookies", cookiesFile] : [];
}

function getBaseArgs(): string[] {
  return ["--user-agent", UA];
}

// ─── 视频信息提取 ───

export async function extractVideoInfo(url: string): Promise<VideoInfo> {
  const args = [...getBaseArgs(), "--dump-json", "--no-playlist", ...(await getCookieArgs()), url];
  const { stdout } = await execFileAsync(YT_DLP_PATH, args);
  const data = JSON.parse(stdout);
  return {
    id: data.id || data.display_id || path.basename(url),
    title: data.title || "未知标题",
    duration: data.duration || 0,
    thumbnail: data.thumbnail || "",
    uploader: data.uploader || data.channel || data.uploader_id || "未知上传者",
  };
}

// ─── 音频下载 ───

export async function downloadAudio(url: string): Promise<ProcessResult> {
  await ensureTempDir();

  const info = await extractVideoInfo(url);
  const safeId = info.id.replace(/[/\\?%*:|"<>]/g, "_");
  const outputTemplate = path.join(TEMP_DIR, `${safeId}.%(ext)s`);

  await execFileAsync(YT_DLP_PATH, [
    ...getBaseArgs(),
    "-f", "bestaudio[ext=m4a]/bestaudio",
    "--output", outputTemplate,
    "--no-playlist",
    ...(await getCookieArgs()),
    url,
  ]);

  const audioPath = path.join(TEMP_DIR, `${safeId}.m4a`);
  return { info, audioPath };
}

// ─── 清理 ───

export async function cleanupTempFiles(videoId: string): Promise<void> {
  const safeId = videoId.replace(/[/\\?%*:|"<>]/g, "_");
  const files = await fs.readdir(TEMP_DIR);
  const targetFiles = files.filter((f) => f.startsWith(safeId));
  await Promise.all(
    targetFiles.map((f) =>
      fs.unlink(path.join(TEMP_DIR, f)).catch(() => {})
    )
  );
}