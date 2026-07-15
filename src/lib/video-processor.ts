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

// ─── 检测 yt-dlp 是否可用（serverless 环境没有）───

let ytdlpAvailable: boolean | null = null;
async function isYtdlpAvailable(): Promise<boolean> {
  if (ytdlpAvailable !== null) return ytdlpAvailable;
  try {
    await execFileAsync(YT_DLP_PATH, ["--version"]);
    ytdlpAvailable = true;
  } catch {
    ytdlpAvailable = false;
  }
  return ytdlpAvailable;
}

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

function ensureTempDir(): Promise<string> {
  return fs.mkdir(TEMP_DIR, { recursive: true }).then(() => TEMP_DIR);
}

function getCookieArgs(): string[] {
  if (existsSync(COOKIES_FILE)) {
    return ["--cookies", COOKIES_FILE];
  }
  return ["--cookies-from-browser", "firefox"];
}

// ─── yt-dlp 模式（本地开发） ───

async function extractVideoInfoYtdlp(url: string): Promise<VideoInfo> {
  const args = ["--dump-json", "--no-playlist", ...getCookieArgs(), url];
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

async function downloadAudioYtdlp(url: string): Promise<ProcessResult> {
  await ensureTempDir();
  const info = await extractVideoInfoYtdlp(url);
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
}

// ─── ytdl-core 模式（serverless 部署） ───

async function downloadAudioYtdlCore(url: string): Promise<ProcessResult> {
  const ytdl = (await import("@distube/ytdl-core")).default;
  await ensureTempDir();

  const info = await ytdl.getInfo(url);
  const videoDetails = info.videoDetails;
  const videoInfo: VideoInfo = {
    id: videoDetails.videoId,
    title: videoDetails.title,
    duration: parseInt(videoDetails.lengthSeconds),
    thumbnail: videoDetails.thumbnails?.[videoDetails.thumbnails.length - 1]?.url || "",
    uploader: videoDetails.author?.name || videoDetails.ownerChannelName || "Unknown",
  };

  // 下载纯音频流
  const audioFormat = ytdl.chooseFormat(info.formats, { filter: "audioonly", quality: "highestaudio" });
  const ext = audioFormat.container || "m4a";
  const audioPath = path.join(TEMP_DIR, `${videoInfo.id}.${ext}`);

  const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
  const writeStream = (await import("fs")).createWriteStream(audioPath);

  await new Promise<void>((resolve, reject) => {
    stream.pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    stream.on("error", reject);
  });

  return { info: videoInfo, audioPath, subtitlePath: null };
}

// ─── 统一入口 ───

export async function extractVideoInfo(url: string): Promise<VideoInfo> {
  if (await isYtdlpAvailable()) {
    return extractVideoInfoYtdlp(url);
  }
  // serverless 模式：YouTube 用 ytdl-core
  if (detectPlatform(url) === "youtube") {
    const ytdl = (await import("@distube/ytdl-core")).default;
    const info = await ytdl.getInfo(url);
    const vd = info.videoDetails;
    return {
      id: vd.videoId,
      title: vd.title,
      duration: parseInt(vd.lengthSeconds),
      thumbnail: vd.thumbnails?.[vd.thumbnails.length - 1]?.url || "",
      uploader: vd.author?.name || vd.ownerChannelName || "Unknown",
    };
  }
  throw new Error("serverless 环境不支持抖音视频处理");
}

export async function downloadAudio(url: string): Promise<ProcessResult> {
  const platform = detectPlatform(url);

  if (platform === "youtube") {
    if (await isYtdlpAvailable()) {
      return downloadAudioYtdlp(url);
    }
    return downloadAudioYtdlCore(url);
  }

  // 抖音
  if (await isYtdlpAvailable()) {
    await ensureTempDir();
    const { extractDouyinInfo, downloadDouyinAudio } = await import("./douyin-processor");
    const { info, videoUrl } = await extractDouyinInfo(url);
    const audioPath = await downloadDouyinAudio(videoUrl, info.id);
    return { info, audioPath, subtitlePath: null };
  }

  throw new Error("serverless 环境不支持抖音视频处理，请使用 YouTube 链接");
}

// ─── 字幕下载（仅 yt-dlp 本地模式支持） ───

export async function tryDownloadSubtitles(url: string): Promise<{
  info: VideoInfo;
  subtitlePath: string | null;
}> {
  // serverless 环境跳过字幕下载，直接走 SenseVoice
  if (!(await isYtdlpAvailable())) {
    const info = await extractVideoInfo(url);
    return { info, subtitlePath: null };
  }

  await ensureTempDir();
  const info = await extractVideoInfoYtdlp(url);
  const outputTemplate = path.join(TEMP_DIR, `${info.id}`);

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

// ─── 完整流水线（保留兼容） ───

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
    return {
      info: result.info,
      text,
      segments,
      language: "auto",
      source: "subtitles",
    };
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