import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { detectPlatform } from "./url-utils";

const execFileAsync = promisify(execFile);

const TEMP_DIR = path.join(os.tmpdir(), "vidsnap");
const LOCAL_YTDLP = path.join(process.cwd(), "bin", "yt-dlp");
const YT_DLP_PATH = existsSync(LOCAL_YTDLP) ? LOCAL_YTDLP : "yt-dlp";
const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");

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
  subtitlePath: string | null;
}

// ─── 工具 ───

const ENV_COOKIES_FILE = path.join(os.tmpdir(), "vidsnap_cookies.txt");

function ensureTempDir(): Promise<string> {
  return fs.mkdir(TEMP_DIR, { recursive: true }).then(() => TEMP_DIR);
}

/**
 * 将 YOUTUBE_COOKIES 环境变量写入 Netscape 格式的 cookies 文件
 */
async function writeEnvCookies(): Promise<string | null> {
  const cookieStr = process.env.YOUTUBE_COOKIES;
  console.log("[vidSnap] YOUTUBE_COOKIES length:", cookieStr?.length || 0);
  if (!cookieStr || cookieStr.length < 50) {
    console.log("[vidSnap] YOUTUBE_COOKIES too short or missing, skipping");
    return null;
  }
  await fs.writeFile(ENV_COOKIES_FILE, cookieStr);
  const stat = await fs.stat(ENV_COOKIES_FILE).catch(() => null);
  console.log("[vidSnap] cookies file written:", ENV_COOKIES_FILE, "size:", stat?.size);
  return ENV_COOKIES_FILE;
}

async function getCookieArgs(): Promise<string[]> {
  if (existsSync(COOKIES_FILE)) {
    return ["--cookies", COOKIES_FILE];
  }
  const envCookies = await writeEnvCookies();
  if (envCookies) {
    return ["--cookies", envCookies];
  }
  return [];
}

function getBaseArgs(): string[] {
  return [
    "--extractor-args", "youtube:player_client=ios",
  ];
}

// ─── 视频信息提取 ───

export async function extractVideoInfo(url: string): Promise<VideoInfo> {
  const args = [...getBaseArgs(), "--dump-json", "--no-playlist", ...(await getCookieArgs()), url];
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

// ─── 音频下载 ───

export async function downloadAudio(url: string): Promise<ProcessResult> {
  await ensureTempDir();
  const platform = detectPlatform(url);

  if (platform === "youtube") {
    const info = await extractVideoInfo(url);
    const outputTemplate = path.join(TEMP_DIR, `${info.id}.%(ext)s`);

    await execFileAsync(YT_DLP_PATH, [
      ...getBaseArgs(),
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "--output", outputTemplate,
      "--no-playlist",
      ...(await getCookieArgs()),
      url,
    ]);

    const audioPath = path.join(TEMP_DIR, `${info.id}.m4a`);
    return { info, audioPath, subtitlePath: null };
  }

  // 抖音
  const { extractDouyinInfo, downloadDouyinAudio } = await import("./douyin-processor");
  const { info, videoUrl } = await extractDouyinInfo(url);
  const audioPath = await downloadDouyinAudio(videoUrl, info.id);
  return { info, audioPath, subtitlePath: null };
}

// ─── 字幕下载 ───

export async function tryDownloadSubtitles(url: string): Promise<{
  info: VideoInfo;
  subtitlePath: string | null;
}> {
  await ensureTempDir();
  const info = await extractVideoInfo(url);
  const outputTemplate = path.join(TEMP_DIR, `${info.id}`);

  const subtitleStrategies = [
    ["--write-subs", "--sub-lang", "zh-Hans,zh-CN,zh-TW,zh,en,ja,ko"],
    ["--write-auto-subs", "--sub-lang", "zh-Hans,zh,en,ja,ko,de,fr,es,pt,ru,ar"],
  ];

  for (const strategy of subtitleStrategies) {
    try {
      await execFileAsync(YT_DLP_PATH, [
        ...getBaseArgs(),
        "--skip-download",
        ...strategy,
        "--convert-subs", "srt",
        "--output", outputTemplate,
        "--no-playlist",
        ...(await getCookieArgs()),
        url,
      ], { timeout: 30000 });

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
      continue;
    }
  }

  return { info, subtitlePath: null };
}

// ─── 完整流水线 ───

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

  if (result.subtitlePath) {
    const vttContent = await fs.readFile(result.subtitlePath, "utf-8");
    const { text, segments } = parseVTT(vttContent);
    return { info: result.info, text, segments, language: "auto", source: "subtitles" };
  }

  const transcription = await transcribeAudioFn(result.audioPath);
  return {
    info: result.info,
    text: transcription.text,
    segments: transcription.segments,
    language: transcription.language,
    source: "asr",
  };
}

// ─── VTT 解析 ───

function parseVTT(content: string): { text: string; segments: Array<{ start: number; end: number; text: string }> } {
  const lines = content.split("\n");
  const segments: Array<{ start: number; end: number; text: string }> = [];
  let currentStart = 0;
  let currentEnd = 0;
  const textLines: string[] = [];

  let i = 0;
  while (i < lines.length && !lines[i].includes("-->")) i++;

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes("-->")) {
      const [start, end] = line.split("-->").map(parseTimestamp);
      currentStart = start;
      currentEnd = end;
    } else if (line === "") {
      continue;
    } else if (line && !line.match(/^\d+$/)) {
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
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 1000;
  }
  const match2 = trimmed.match(/(\d+):(\d+)\.(\d+)/);
  if (match2) {
    return parseInt(match2[1]) * 60 + parseInt(match2[2]) + parseInt(match2[3]) / 1000;
  }
  return 0;
}

// ─── 清理 ───

export async function cleanupTempFiles(videoId: string): Promise<void> {
  const files = await fs.readdir(TEMP_DIR);
  const targetFiles = files.filter((f) => f.startsWith(videoId));
  await Promise.all(
    targetFiles.map((f) =>
      fs.unlink(path.join(TEMP_DIR, f)).catch(() => {})
    )
  );
}