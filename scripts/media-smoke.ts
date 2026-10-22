import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runYtDlp } from "../src/lib/media-network";
import { parseBuiltinSubtitle } from "../src/lib/transcriber";

const execute = promisify(execFile);
export const SAMPLE_ID = "jNQXAC9IVRw";
export const SAMPLE_URL = `https://www.youtube.com/watch?v=${SAMPLE_ID}`;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 512 * 1024;

type Check = { id: string; status: "pass" | "fail" | "skip"; details: Record<string, unknown> };
type Command = (args: string[], timeout: number) => Promise<{ stdout: string; stderr: string }>;
export type MediaSmokeDependencies = {
  run: Command;
  probe: (file: string) => Promise<string>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 固定公开样本先通过元信息门槛；没有已知大小的直连音频时不猜测下载。 */
export function validateSample(value: unknown) {
  if (!record(value) || value.id !== SAMPLE_ID || typeof value.duration !== "number"
      || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 30
      || value.is_live === true || ["is_live", "is_upcoming", "post_live"].includes(String(value.live_status))) {
    throw new Error("sample_metadata_rejected");
  }
  const formats = Array.isArray(value.formats) ? value.formats.filter(record) : [];
  const audio = formats.filter((item) => typeof item.format_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(item.format_id)
    && typeof item.acodec === "string" && item.acodec !== "none" && item.vcodec === "none" && item.protocol === "https"
    && typeof item.filesize === "number" && item.filesize > 0 && item.filesize <= MAX_AUDIO_BYTES
    && ["m4a", "webm", "ogg", "opus", "mp3"].includes(String(item.ext)))
    .sort((left, right) => Number(left.filesize) - Number(right.filesize))[0];
  const subtitles = record(value.subtitles) && Array.isArray(value.subtitles.en) ? value.subtitles.en : [];
  return { duration: value.duration, audioFormat: typeof audio?.format_id === "string" ? audio.format_id : undefined,
    manualEnglish: subtitles.some((item) => record(item) && item.ext === "vtt") };
}

/** 仅返回固定分类；原始 stderr 可能含签名 URL、请求头或本地路径。 */
export function errorCategory(error: unknown): string {
  const stderr = record(error) && typeof error.stderr === "string" ? error.stderr.toLowerCase() : "";
  if (/networkpolicyerror|network policy rejected/.test(stderr)) return "media_policy_rejected";
  if (/not a bot|sign in|login required/.test(stderr)) return "platform_login_or_challenge";
  if (/429|too many requests/.test(stderr)) return "upstream_rate_limited";
  if (/403|forbidden/.test(stderr)) return "upstream_http_403";
  if (/timed out|timeoutexpired|timeouterror/.test(stderr) || (record(error) && error.killed === true)) return "stage_timeout";
  if (/certificate|sslerror/.test(stderr)) return "upstream_tls_failed";
  return "stage_failed";
}

const defaults: MediaSmokeDependencies = {
  run: runYtDlp,
  async probe(file) {
    const result = await execute("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe",
      "-show_entries", "format=duration:stream=codec_type", "-of", "json", file], { timeout: 10000, windowsHide: true });
    return result.stdout;
  },
};

export async function checkMedia(dependencies = defaults) {
  const checks: Check[] = [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-media-smoke-"));
  const common = ["--no-playlist", "--js-runtimes", "node", "--retries", "0", "--extractor-retries", "0", "--no-progress", "--no-warnings"];
  let metadata: ReturnType<typeof validateSample> | undefined;
  let stage = "metadata";
  const started = performance.now();
  try {
    try {
      const result = await dependencies.run([...common, "--dump-single-json", "--skip-download", SAMPLE_URL], 65000);
      metadata = validateSample(JSON.parse(result.stdout));
      checks.push({ id: stage, status: "pass", details: { duration_seconds: metadata.duration } });
    } catch (error) {
      checks.push({ id: stage, status: "fail", details: { category: errorCategory(error) } });
    }
    stage = "subtitle";
    if (!metadata) checks.push({ id: stage, status: "skip", details: { reason: "metadata_failed" } });
    else if (!metadata.manualEnglish) checks.push({ id: stage, status: "skip", details: { reason: "manual_english_vtt_absent" } });
    else try {
      await dependencies.run([...common, "--skip-download", "--write-subs", "--sub-langs", "en", "--sub-format", "vtt",
        "--output", path.join(directory, "subtitle"), SAMPLE_URL], 30000);
      const file = path.join(directory, "subtitle.en.vtt");
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SUBTITLE_BYTES) throw new Error("subtitle_size_rejected");
      const transcript = await parseBuiltinSubtitle(file);
      const duration = metadata.duration;
      const valid = transcript.text.trim().length > 0 && transcript.segments.length > 0
        && transcript.segments.every((item) => item.start >= 0 && item.end >= item.start && item.end <= duration + 2);
      checks.push({ id: stage, status: valid ? "pass" : "fail", details: { bytes: stat.size, segments: transcript.segments.length, timestamp_range_valid: valid } });
    } catch (error) {
      checks.push({ id: stage, status: "fail", details: { category: errorCategory(error) } });
    }
    stage = "audio";
    if (!metadata) checks.push({ id: stage, status: "skip", details: { reason: "metadata_failed" } });
    else if (!metadata.audioFormat) checks.push({ id: stage, status: "skip", details: { reason: "bounded_https_audio_absent" } });
    else try {
      // 只下载已声明大小的单一 HTTPS 音轨；下载器再检查响应大小、限速，并由边界进程限时。
      await dependencies.run([...common, "-f", metadata.audioFormat, "--max-filesize", String(MAX_AUDIO_BYTES),
        "--limit-rate", "128K", "--fragment-retries", "0", "--output", path.join(directory, "audio.%(ext)s"), SAMPLE_URL], 50000);
      const files = (await fs.readdir(directory)).filter((name) => /^audio\.(m4a|webm|ogg|opus|mp3)$/.test(name));
      if (files.length !== 1) throw new Error("audio_artifact_rejected");
      const file = path.join(directory, files[0]);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUDIO_BYTES) throw new Error("audio_size_rejected");
      const probe: unknown = JSON.parse(await dependencies.probe(file));
      const duration = record(probe) && record(probe.format) ? Number(probe.format.duration) : NaN;
      const audio = record(probe) && Array.isArray(probe.streams) && probe.streams.some((item) => record(item) && item.codec_type === "audio");
      const valid = audio && Number.isFinite(duration) && duration > 0 && Math.abs(duration - metadata.duration) <= 2;
      checks.push({ id: stage, status: valid ? "pass" : "fail", details: { bytes: stat.size, extension: path.extname(file), duration_seconds: duration, audio_stream_present: !!audio } });
    } catch (error) {
      checks.push({ id: stage, status: "fail", details: { category: errorCategory(error) } });
    }
  } finally {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      checks.push({ id: "cleanup", status: "pass", details: {} });
    } catch {
      checks.push({ id: "cleanup", status: "fail", details: { reason: "owned_temporary_directory_cleanup_failed" } });
    }
  }
  return { schema_version: 1, scope: "fixed_public_youtube_media", sample_id: SAMPLE_ID,
    full_pipeline_verified: false, media_sample_verified: checks.length === 4 && checks.every((item) => item.status === "pass"),
    elapsed_ms: Math.round(performance.now() - started), checks };
}
