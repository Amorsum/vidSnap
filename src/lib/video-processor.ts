import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { detectPlatform } from "./url-utils";

const execFileAsync = promisify(execFile);

const TEMP_DIR = path.join(os.tmpdir(), "vidsnap");
const YT_DLP_PATH = "yt-dlp";
const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");

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
  subtitlePath: string | null;
}

function ensureTempDir(): Promise<string> {
  return fs.mkdir(TEMP_DIR, { recursive: true }).then(() => TEMP_DIR);
}

/**
 * 获取 cookie 参数：优先使用 cookies.txt 文件，兜底尝试 Firefox 浏览器
 * - cookies.txt: 放置于项目根目录，从任意浏览器导出，通用性最好
 * - Firefox: cookie 不使用 DPAPI 加密，yt-dlp 可直接读取
 */
function getCookieArgs(): string[] {
  if (existsSync(COOKIES_FILE)) {
    return ["--cookies", COOKIES_FILE];
  }
  // Firefox 的 cookie 不加密，不受 Windows DPAPI 限制
  return ["--cookies-from-browser", "firefox"];
}

/**
 * 解析视频链接，提取视频元信息（支持 YouTube / 抖音 / 等 yt-dlp 兼容平台）
 */
export async function extractVideoInfo(url: string): Promise<VideoInfo> {
  const args = [
    "--dump-json",
    "--no-playlist",
    ...getCookieArgs(),
    url,
  ];
  const { stdout } = await execFileAsync(YT_DLP_PATH, args);

  const data = JSON.parse(stdout);
  return {
    id: data.id,
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail,
    uploader: data.uploader || data.channel || data.uploader_id || data.creator || "Unknown",
  };
}

/**
 * 下载音频（仅音频，不下载视频）
 * 不再尝试下载字幕，统一使用 Whisper ASR 转写
 */
export async function downloadAudio(url: string): Promise<ProcessResult> {
  await ensureTempDir();

  const platform = detectPlatform(url);
  if (platform === "youtube") {
    // YouTube 走 yt-dlp 流程
    const info = await extractVideoInfo(url);
    const outputTemplate = path.join(TEMP_DIR, `${info.id}.%(ext)s`);

    await execFileAsync(YT_DLP_PATH, [
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "--output", outputTemplate,
      "--no-playlist",
      ...getCookieArgs(),
      url,
    ]);

    const audioPath = path.join(TEMP_DIR, `${info.id}.m4a`);

    return { info, audioPath, subtitlePath: null };
  } else {
    // Douyin 走 Playwright 提取流程
    const { extractDouyinInfo, downloadDouyinAudio } = await import("./douyin-processor");
    const { info, videoUrl } = await extractDouyinInfo(url);
    const audioPath = await downloadDouyinAudio(videoUrl, info.id);
    return { info, audioPath, subtitlePath: null };
  }
}

/**
 * 仅下载字幕（不下载视频），用于 YouTube 快速路径
 * 成功返回字幕文件路径，失败返回 null
 */
export async function tryDownloadSubtitles(url: string): Promise<{
  info: VideoInfo;
  subtitlePath: string | null;
}> {
  await ensureTempDir();
  const info = await extractVideoInfo(url);
  const outputTemplate = path.join(TEMP_DIR, `${info.id}`);

  // 先尝试手动字幕，再尝试自动字幕
  // 扩大语言范围，提高命中率（命中 = 跳过 Whisper，省 10-60s）
  const subtitleStrategies = [
    ["--write-subs", "--sub-lang", "zh-Hans,zh-CN,zh-TW,zh,en,ja,ko"],
    ["--write-auto-subs", "--sub-lang", "zh-Hans,zh,en,ja,ko,de,fr,es,pt,ru,ar"],
  ];

  for (const strategy of subtitleStrategies) {
    try {
      await execFileAsync(YT_DLP_PATH, [
        "--skip-download",
        ...strategy,
        "--convert-subs", "srt",
        "--output", outputTemplate,
        "--no-playlist",
        ...getCookieArgs(),
        url,
      ], { timeout: 30000 });

      // 检查是否下载了字幕文件
      const possiblePaths = [
            path.join(TEMP_DIR, `${info.id}.zh-Hans.srt`),
            path.join(TEMP_DIR, `${info.id}.zh-CN.srt`),
            path.join(TEMP_DIR, `${info.id}.zh-TW.srt`),
            path.join(TEMP_DIR, `${info.id}.zh.srt`),
            path.join(TEMP_DIR, `${info.id}.en.srt`),
            path.join(TEMP_DIR, `${info.id}.ja.srt`),
            path.join(TEMP_DIR, `${info.id}.ko.srt`),
            path.join(TEMP_DIR, `${info.id}.de.srt`),
            path.join(TEMP_DIR, `${info.id}.fr.srt`),
            path.join(TEMP_DIR, `${info.id}.es.srt`),
          ];
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          return { info, subtitlePath: p };
        }
      }
    } catch {
      // 该策略失败，尝试下一个
      continue;
    }
  }

  return { info, subtitlePath: null };
}

/**
 * 完整流水线：下载音频 → 提取字幕文本（优先使用已有字幕，否则用 ASR）
 */
export async function extractTextFromVideo(
  url: string,
  transcribeAudioFn: (audioPath: string) => Promise<{ text: string; segments: Array<{ start: number; end: number; text: string }>; language: string }>
): Promise<{
  info: VideoInfo;
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  language: string;
  source: "subtitles" | "asr";
}> {
  const result = await downloadAudio(url);

  // 如果有字幕，直接解析 VTT
  if (result.subtitlePath) {
    const vttContent = await fs.readFile(result.subtitlePath, "utf-8");
    const { text, segments } = parseVTT(vttContent);
    return {
      info: result.info,
      text,
      segments,
      language: "auto",
      source: "subtitles",
    };
  }

  // 没有字幕，使用 Whisper ASR
  const transcription = await transcribeAudioFn(result.audioPath);
  return {
    info: result.info,
    text: transcription.text,
    segments: transcription.segments,
    language: transcription.language,
    source: "asr",
  };
}

/**
 * 简单的 VTT 解析器
 */
function parseVTT(content: string): { text: string; segments: Array<{ start: number; end: number; text: string }> } {
  const lines = content.split("\n");
  const segments: Array<{ start: number; end: number; text: string }> = [];
  let currentStart = 0;
  let currentEnd = 0;
  const textLines: string[] = [];

  // 跳过 WEBVTT 头
  let i = 0;
  while (i < lines.length && !lines[i].includes("-->")) {
    i++;
  }

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes("-->")) {
      const [start, end] = line.split("-->").map(parseTimestamp);
      currentStart = start;
      currentEnd = end;
    } else if (line === "") {
      // 空行分隔
      continue;
    } else if (line && !line.match(/^\d+$/)) {
      // 去除 VTT 标签
      const cleanText = line.replace(/<[^>]+>/g, "").trim();
      if (cleanText) {
        segments.push({ start: currentStart, end: currentEnd, text: cleanText });
        textLines.push(cleanText);
      }
    }
  }

  return { text: textLines.join(" "), segments };
}

function parseTimestamp(ts: string): number {
  const trimmed = ts.trim();
  const match = trimmed.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (match) {
    return (
      parseInt(match[1]) * 3600 +
      parseInt(match[2]) * 60 +
      parseInt(match[3]) +
      parseInt(match[4]) / 1000
    );
  }
  // 也支持 mm:ss.ms 格式
  const match2 = trimmed.match(/(\d+):(\d+)\.(\d+)/);
  if (match2) {
    return (
      parseInt(match2[1]) * 60 +
      parseInt(match2[2]) +
      parseInt(match2[3]) / 1000
    );
  }
  return 0;
}

/**
 * 清理临时文件
 */
export async function cleanupTempFiles(videoId: string): Promise<void> {
  const files = await fs.readdir(TEMP_DIR);
  const targetFiles = files.filter((f) => f.startsWith(videoId));

  await Promise.all(
    targetFiles.map((f) =>
      fs.unlink(path.join(TEMP_DIR, f)).catch(() => {})
    )
  );
}