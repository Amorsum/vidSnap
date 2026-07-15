import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { VideoInfo } from "./video-processor";

const execFileAsync = promisify(execFile);
const TEMP_DIR = path.join(process.cwd(), "tmp");
const PLAYWRIGHT_SCRIPT = path.join(process.cwd(), "scripts", "douyin_playwright.py");

interface DouyinRawInfo {
  id: string;
  title: string;
  duration: number; // 毫秒
  thumbnail: string;
  uploader: string;
  video_url: string;
  audio_url: string | null;
  error?: string;
}

export interface DouyinResult {
  info: VideoInfo;
  videoUrl: string;
}

/**
 * 用 Playwright 提取抖音视频信息（绕过 X-Bogus 签名）
 */
export async function extractDouyinInfo(url: string): Promise<DouyinResult> {
  const { stdout, stderr } = await execFileAsync("python", [PLAYWRIGHT_SCRIPT, url], {
    timeout: 60000,
  });

  // stderr 包含日志，stdout 包含 JSON 结果
  const data = JSON.parse(stdout) as DouyinRawInfo;

  if (data.error) {
    throw new Error(data.error);
  }

  return {
    info: {
      id: data.id,
      title: data.title,
      duration: Math.round(data.duration / 1000), // 毫秒 → 秒
      thumbnail: data.thumbnail,
      uploader: data.uploader,
    },
    videoUrl: data.video_url,
  };
}

/**
 * 下载抖音视频，提取音频为 m4a
 */
export async function downloadDouyinAudio(videoUrl: string, videoId: string): Promise<string> {
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const videoPath = path.join(TEMP_DIR, `${videoId}.mp4`);
  const audioPath = path.join(TEMP_DIR, `${videoId}.m4a`);

  // 用 yt-dlp 下载视频（直接 URL）
  try {
    await execFileAsync("yt-dlp", [
      "-f", "best",
      "-o", videoPath,
      "--no-playlist",
      videoUrl,
    ], { timeout: 120000 });
  } catch {
    // yt-dlp 失败则用 ffmpeg 直接下载
    await execFileAsync("ffmpeg", [
      "-y",
      "-headers", "Referer: https://www.douyin.com/",
      "-i", videoUrl,
      "-c", "copy",
      videoPath,
    ], { timeout: 120000 });
  }

  // 用 ffmpeg 提取音频
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "aac",
    "-b:a", "128k",
    audioPath,
  ], { timeout: 60000 });

  // 清理视频文件
  fs.unlink(videoPath).catch(() => {});

  return audioPath;
}