import os from "os";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { detectPlatform, normalizeVideoUrl } from "./url-utils";
import { withMediaWorkspace } from "./media-workspace";
import { runYtDlp, downloadPublicSubtitle } from "./media-network";
import { parseBuiltinSubtitle } from "./transcriber";
import { isValidVideoId } from "./request-validation";
import { selectSubtitleTracks, SubtitleTrackHandoff, type SubtitleSelection } from "./subtitle-tracks";
import { resolveMediaOutput } from "./media-output";
import type { VisionBudget } from "./vision-budget";

const TEMP_DIR = path.join(os.tmpdir(), "vidsnap");
const COOKIES_FILE = path.join(process.cwd(), "cookies.txt");
// 伪装浏览器 UA，降低 YouTube 反爬对 yt-dlp 的识别概率
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

const subtitleHandoff = new SubtitleTrackHandoff<VideoInfo>();

export interface ProcessResult {
  info: VideoInfo;
  audioPath: string;
  subtitlePath: string | null;
  /** 仅保留语言和轨道来源，绝不携带带签名的下载地址。 */
  subtitle?: SubtitleSelection;
  /** 视频源文件路径（仅视觉理解启用时保留，供抽关键帧使用） */
  videoPath?: string | null;
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

// --js-runtimes 参数在 yt-dlp 2025.02 才加入，旧版本会报 unrecognized arguments 直接失败。
// 启动时探测一次版本并缓存结果，旧版本自动降级（不带该参数）。
let jsRuntimesSupported: boolean | null = null;

async function supportsJsRuntimes(): Promise<boolean> {
  if (jsRuntimesSupported !== null) return jsRuntimesSupported;
  try {
    const { stdout } = await runYtDlp(["--version"], 10000);
    const [major, minor = 0] = stdout.trim().split(".").map(Number);
    jsRuntimesSupported = major > 2025 || (major === 2025 && minor >= 2);
  } catch {
    jsRuntimesSupported = false;
  }
  return jsRuntimesSupported;
}

/**
 * 统一的 yt-dlp 公共参数：浏览器 UA 伪装 + JS runtime（新版支持时）
 * 三个调用点（信息提取/下载音频/下载字幕）共用，避免反爬参数只改一处导致路径相关失败
 */
async function getCommonYtDlpArgs(): Promise<string[]> {
  const args = ["--user-agent", BROWSER_UA];
  if (await supportsJsRuntimes()) {
    args.push("--js-runtimes", "node");
  }
  return args;
}

/**
 * 解析视频链接，提取视频元信息（支持 YouTube / 抖音 / 等 yt-dlp 兼容平台）
 */
export async function extractVideoInfo(url: string): Promise<VideoInfo> {
  url = normalizeVideoUrl(url);
  const args = [
    "--dump-json",
    "--no-playlist",
    ...(await getCommonYtDlpArgs()),
    ...getCookieArgs(),
    url,
  ];
  const { stdout } = await runYtDlp(args);

  const data = JSON.parse(stdout);
  if (!isValidVideoId(data.id)) throw new Error("视频元信息中的 ID 无效");
  const info: VideoInfo = {
    id: data.id,
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail,
    uploader: data.uploader || data.channel || data.uploader_id || data.creator || "Unknown",
  };
  subtitleHandoff.remember(info, url, selectSubtitleTracks(data));
  return info;
}

/**
 * 下载音频（仅音频，不下载视频）
 * 本函数只负责音频，转写由调用方选择云端或本地模型。
 * info 可由调用方预先提取（如 tryDownloadSubtitles 已拿到），避免重复 --dump-json
 */
export async function downloadAudio(url: string, preInfo?: VideoInfo, directory = TEMP_DIR): Promise<ProcessResult> {
  url = normalizeVideoUrl(url);
  await ensureTempDir();

  const platform = detectPlatform(url);
  if (platform === "youtube") {
    // YouTube 走 yt-dlp 流程
    const info = preInfo ?? (await extractVideoInfo(url));
    if (!isValidVideoId(info.id)) throw new Error("视频元信息中的 ID 无效");
    subtitleHandoff.take(info, url);
    const outputTemplate = path.join(directory, `${info.id}.%(ext)s`);

    const { stdout } = await runYtDlp([
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "--output", outputTemplate,
      "--no-playlist",
      "--no-simulate", "--print", "after_move:%(filepath)j",
      ...(await getCommonYtDlpArgs()),
      ...getCookieArgs(),
      url,
    ]);

    const audioPath = await resolveMediaOutput(stdout, directory, info.id, ["m4a", "webm", "opus", "ogg", "mp3", "mp4", "flac", "wav"]);

    return { info, audioPath, subtitlePath: null };
  } else {
    // Douyin 走 Playwright 提取流程（与 platforms.ts 共用同一实现）
    const { extractAndDownloadDouyinAudio } = await import("./douyin-processor");
    const { info, audioPath } = await extractAndDownloadDouyinAudio(url, directory);
    return { info, audioPath, subtitlePath: null };
  }
}

/**
 * 下载低分辨率视频流（仅用于关键帧提取，不参与转写）
 * 格式链三层回退（240p → 144p），尽量降低下载体积与耗时
 * 失败由调用方 catch 降级为音频-only，不阻塞主流程
 */
export async function downloadLowResVideo(url: string, preInfo?: VideoInfo, directory = TEMP_DIR, budget?: VisionBudget): Promise<string> {
  url = normalizeVideoUrl(url);
  await ensureTempDir();
  const info = preInfo ?? (await extractVideoInfo(url));
  if (!isValidVideoId(info.id)) throw new Error("视频元信息中的 ID 无效");
  subtitleHandoff.take(info, url);
  const outputTemplate = path.join(directory, `${info.id}-video.%(ext)s`);
  const commonArgs = await getCommonYtDlpArgs();
  // 给 Python 杀死其 yt-dlp 子进程和关闭代理预留 2 秒，不能只让 Node 提前返回。
  const timeout = budget ? Math.floor((budget.remainingMs(3000) - 2000) / 1000) * 1000 : 120000;

  const args = [
    "-f", "best[height<=240]/bestvideo[height<=240]/best[height<=144]",
    "--output", outputTemplate,
    "--no-playlist",
    "--no-simulate", "--print", "after_move:%(filepath)j",
    ...commonArgs,
    ...getCookieArgs(),
    url,
  ];
  let stdout: string;
  try {
    ({ stdout } = await runYtDlp(args, timeout, budget ? 2000 : 10000));
  } catch (error) {
    budget?.remainingMs(3000);
    throw error;
  }

  budget?.remainingMs();
  return resolveMediaOutput(stdout, directory, `${info.id}-video`, ["mp4", "webm", "mkv", "m4v", "3gp"]);
}

async function usableSubtitle(file: string, duration: number): Promise<boolean> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > 4 * 1024 * 1024) return false;
  const transcript = await parseBuiltinSubtitle(file);
  return transcript.text.replace(/<[^>]*>/g, "").trim().length > 0 && transcript.segments.length > 0
    && transcript.segments.every((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end)
      && segment.start >= 0 && segment.end > segment.start && (!(duration > 0) || segment.end <= duration + 2));
}

/**
 * 仅下载字幕（不下载视频），用于 YouTube 快速路径
 * 成功返回字幕文件路径，失败返回 null
 * info 可由调用方预先提取，避免重复 --dump-json
 */
export async function tryDownloadSubtitles(url: string, preInfo?: VideoInfo, directory = TEMP_DIR, assertActive?: () => void): Promise<{
  info: VideoInfo;
  subtitlePath: string | null;
  subtitle?: SubtitleSelection;
}> {
  url = normalizeVideoUrl(url);
  await ensureTempDir();
  const info = preInfo ?? (await extractVideoInfo(url));
  if (!isValidVideoId(info.id)) throw new Error("视频元信息中的 ID 无效");
  let tracks = subtitleHandoff.take(info, url);
  if (!tracks) {
    // 上下文被复制、交接过期或容量淘汰时重新解析，不复用过期签名。
    assertActive?.();
    try {
      const refreshed = await extractVideoInfo(url);
      tracks = subtitleHandoff.take(refreshed, url);
      if (refreshed.id !== info.id) return { info, subtitlePath: null };
    } catch {
      assertActive?.();
      return { info, subtitlePath: null };
    }
  }

  for (const track of tracks ?? []) {
    assertActive?.();
    const file = path.join(directory, `${info.id}.${track.language}.${track.format}`);
    try {
      await downloadPublicSubtitle(track.url, file);
      assertActive?.();
      const valid = await usableSubtitle(file, info.duration);
      assertActive?.();
      if (valid) return { info, subtitlePath: file, subtitle: { language: track.language, kind: track.kind, delivery: "direct" } };
    } catch {
      assertActive?.();
      // 轨道失效/空文件/解析失败后尝试选定自动轨道，仍不成功则交给音频转写。
    }
    await fs.unlink(file).catch(() => {});
  }

  // 直链可能需要 Cookie 或已失效：最多一次原有下载器兜底，仍只请求选中的单轨。
  const fallback = tracks?.[0];
  if (fallback) {
    const file = path.join(directory, `${info.id}.${fallback.language}.${fallback.format}`);
    assertActive?.();
    try {
      await runYtDlp(["--skip-download", fallback.kind === "manual" ? "--write-subs" : "--write-auto-subs",
        "--sub-langs", `^${fallback.language}$`, "--sub-format", fallback.format,
        "--output", path.join(directory, info.id), "--no-playlist", ...(await getCommonYtDlpArgs()), ...getCookieArgs(), url], 30000);
      assertActive?.();
      const valid = await usableSubtitle(file, info.duration);
      assertActive?.();
      if (valid) return { info, subtitlePath: file, subtitle: { language: fallback.language, kind: fallback.kind, delivery: "yt-dlp" } };
    } catch { assertActive?.(); }
    await fs.unlink(file).catch(() => {});
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
  url = normalizeVideoUrl(url);
  const info = detectPlatform(url) === "youtube" ? await extractVideoInfo(url) : undefined;
  return withMediaWorkspace(async (directory) => {
    const result = await downloadAudio(url, info, directory);

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
  });
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
  // 关键帧文件（-kf-）豁免立即清理：生命周期由 keyframes.ts 延迟清理管理
  const targetFiles = files.filter((f) => f.startsWith(videoId) && !f.includes("-kf-"));

  await Promise.all(
    targetFiles.map((f) =>
      fs.unlink(path.join(TEMP_DIR, f)).catch(() => {})
    )
  );
}
