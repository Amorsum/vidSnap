import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { TranscriptResult, TranscriptSegment } from "./transcriber";
import { transcribeAudio } from "./transcriber";
import { transcribeWithSenseVoice } from "./sensevoice";
import { whisperFailureMessage } from "./whisper-client";

const execFileAsync = promisify(execFile);
const CHUNK_SECONDS = 300;
const CLOUD_SAFE_BYTES = 40 * 1024 * 1024;
const MAX_CHUNKS = 144;

interface Options {
  duration: number;
  model?: string;
  onProgress?: (percent: number) => void;
  assertActive?: () => void;
}

interface TranscriptionServices {
  cloud: typeof transcribeWithSenseVoice;
  local: typeof transcribeAudio;
}

/** 根据文件大小和平台元信息决定是否需要预处理；保留短视频已有路径。 */
export async function needsChunkedTranscription(audioPath: string, duration: number): Promise<boolean> {
  const stat = await fs.stat(audioPath).catch(() => { throw new Error("音频文件不可用，无法开始语音转写"); });
  if (stat.size > CLOUD_SAFE_BYTES) return true;
  if (Number.isFinite(duration) && duration > 0) return duration > CHUNK_SECONDS;
  try { return await audioDuration(audioPath) > CHUNK_SECONDS; }
  catch { throw new Error("音频分段准备失败，请检查服务器的 FFprobe 和音频文件"); }
}

async function audioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration", "-of", "json", audioPath],
    { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true });
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== "object" || !("format" in parsed) || !parsed.format || typeof parsed.format !== "object"
      || !("duration" in parsed.format)) throw new Error("无法读取音频时长");
  const duration = Number(parsed.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取音频时长");
  return duration;
}

/** 云端只返回文本；在每个分片内按字符比例估算，避免整段视频累计漂移。 */
function estimateChunkSegments(result: TranscriptResult, start: number, duration: number): TranscriptSegment[] {
  const sentences = result.text.split(/(?<=[。！？.!?\n])\s*/u).map(item => item.trim()).filter(Boolean);
  const total = sentences.reduce((sum, item) => sum + Array.from(item).length, 0);
  let used = 0;
  return sentences.map(text => {
    const before = used;
    used += Array.from(text).length;
    return { start: start + duration * before / total, end: start + duration * used / total, text };
  });
}

/** 分片串行处理；失败仅降级当前及后续片段，不重新上传已成功内容。 */
export async function transcribeLongAudio(audioPath: string, options: Options, services: TranscriptionServices = {
  cloud: transcribeWithSenseVoice, local: transcribeAudio,
}): Promise<TranscriptResult> {
  options.assertActive?.();
  let duration: number;
  try { duration = await audioDuration(audioPath); }
  catch { options.assertActive?.(); throw new Error("音频分段准备失败，请检查服务器的 FFprobe 和音频文件"); }
  options.assertActive?.();
  const count = Math.ceil(duration / CHUNK_SECONDS);
  if (count > MAX_CHUNKS) throw new Error("音频时长超出当前转写范围，请选择不超过 12 小时的视频");
  const directory = await fs.mkdtemp(path.join(path.dirname(audioPath), "asr-chunks-"));
  const texts: string[] = [];
  const segments: TranscriptSegment[] = [];
  let cloudAvailable = !!process.env.SENSEVOICE_API_KEY;
  let usedCloud = false;
  let usedLocal = false;
  try {
    for (let index = 0; index < count; index++) {
      options.assertActive?.();
      const start = index * CHUNK_SECONDS;
      const length = Math.min(CHUNK_SECONDS, duration - start);
      const chunkPath = path.join(directory, `chunk-${index}.m4a`);
      const progress = (value: number) => options.onProgress?.(Math.min(100, (index + Math.max(0, Math.min(100, value)) / 100) / count * 100));
      try {
        try {
          await execFileAsync("ffmpeg", ["-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-ss", String(start), "-i", audioPath,
            "-t", String(length), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", chunkPath],
            { timeout: 90_000, maxBuffer: 1024 * 1024, windowsHide: true });
        } catch { options.assertActive?.(); throw new Error(`音频第 ${index + 1}/${count} 段切分失败，请检查服务器媒体工具`); }
        options.assertActive?.();
        let result: TranscriptResult | undefined;
        if (cloudAvailable) {
          try {
            result = await services.cloud(chunkPath, progress, { allowEmpty: true });
            usedCloud = true;
          } catch {
            options.assertActive?.();
            cloudAvailable = false;
            console.warn(`[transcription] 第 ${index + 1} 段云端转写不可用，后续使用本地 Whisper`);
          }
        }
        options.assertActive?.();
        if (!result) {
          try {
            result = await services.local(chunkPath, { model: options.model, onProgress: progress });
            usedLocal = true;
          } catch (error) {
            options.assertActive?.();
            throw new Error(`转写第 ${index + 1}/${count} 段失败：${whisperFailureMessage(error) ?? "本地语音识别不可用，请稍后重试"}`);
          }
        }
        options.assertActive?.();
        const chunkSegments = result.transcription?.provider === "sensevoice"
          ? estimateChunkSegments(result, start, length)
          : result.segments.filter(segment => segment.start < length && segment.end > segment.start)
            .map(segment => ({ ...segment, start: start + Math.max(0, segment.start), end: start + Math.min(length, segment.end) }));
        if (result.text.trim() && chunkSegments.length === 0) throw new Error(`转写第 ${index + 1}/${count} 段失败：结果缺少有效时间片段`);
        texts.push(result.text.trim());
        segments.push(...chunkSegments);
        progress(100);
      } finally {
        await fs.unlink(chunkPath).catch(() => {});
      }
    }
  } finally {
    await fs.rmdir(directory).catch(() => {});
  }
  if (segments.length === 0) throw new Error("该视频没有检测到语音内容（可能是纯音乐或无声视频），无法生成文字总结");
  return { text: texts.filter(Boolean).join(" "), segments, source: "whisper",
    transcription: { provider: usedCloud && usedLocal ? "unknown" : usedCloud ? "sensevoice" : "whisper", timing: usedCloud ? "estimated" : "source" } };
}
