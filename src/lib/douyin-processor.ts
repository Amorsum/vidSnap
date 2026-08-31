import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { VideoInfo } from "./video-processor";

const execFileAsync = promisify(execFile);
const TEMP_DIR = path.join(os.tmpdir(), "vidsnap");
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
  // Python 在中文 Windows 的 stdout 是 cp936，标题含 emoji 时输出可能为空/损坏，需要兜底
  let data: DouyinRawInfo;
  try {
    data = JSON.parse(stdout) as DouyinRawInfo;
  } catch {
    console.error("[douyin] 解析脚本输出异常，stderr:", stderr);
    throw new Error("抖音解析失败（解析结果异常，请稍后重试）");
  }

  if (data.error) {
    // 保留 Python 侧的真实原因（cookie 过期/视频删除/反爬等），方便排查与引导用户
    console.error("[douyin] 解析失败:", data.error, "stderr:", stderr);
    throw new Error(`抖音解析失败（${data.error}）`);
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
 * 提取信息并下载音频（无 memo 的直通版本，供旧流水线 extractTextFromVideo 使用）
 */
export async function extractAndDownloadDouyinAudio(
  url: string
): Promise<{ info: VideoInfo; audioPath: string }> {
  const { info, videoUrl } = await extractDouyinInfo(url);
  const audioPath = await downloadDouyinAudio(videoUrl, info.id);
  return { info, audioPath };
}

/**
 * 下载抖音视频并提取音频为 m4a
 * keepVideo=true 时保留视频文件（供关键帧提取），由调用方负责后续清理
 */
export async function downloadDouyinVideoAndAudio(
  videoUrl: string,
  videoId: string,
  keepVideo: boolean
): Promise<{ audioPath: string; videoPath: string | null }> {
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const videoPath = path.join(TEMP_DIR, `${videoId}.mp4`);
  const audioPath = path.join(TEMP_DIR, `${videoId}.m4a`);

  // 抖音直链 yt-dlp 无法下载（403），直接用 ffmpeg
  await execFileAsync("ffmpeg", [
    "-y",
    "-headers", "Referer: https://www.douyin.com/",
    "-i", videoUrl,
    "-c", "copy",
    videoPath,
  ], { timeout: 120000 });

  // 用 ffmpeg 提取音频
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-acodec", "aac",
    "-b:a", "128k",
    audioPath,
  ], { timeout: 60000 });

  // 保留视频供抽帧，否则立即清理
  if (!keepVideo) {
    fs.unlink(videoPath).catch(() => {});
    return { audioPath, videoPath: null };
  }

  return { audioPath, videoPath };
}

/**
 * 下载抖音视频，提取音频为 m4a（视频文件用完即删）
 */
export async function downloadDouyinAudio(videoUrl: string, videoId: string): Promise<string> {
  const { audioPath } = await downloadDouyinVideoAndAudio(videoUrl, videoId, false);
  return audioPath;
}