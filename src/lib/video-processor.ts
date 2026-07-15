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

function ensureTempDir(): Promise<string> {
  return fs.mkdir(TEMP_DIR, { recursive: true }).then(() => TEMP_DIR);
}

// ─── 视频信息提取 ───

export async function extractVideoInfo(url: string): Promise<VideoInfo> {
  const args = ["--dump-json", "--no-playlist", url];
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
    "-f", "bestaudio[ext=m4a]/bestaudio",
    "--output", outputTemplate,
    "--no-playlist",
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