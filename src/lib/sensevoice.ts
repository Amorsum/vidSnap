/**
 * 硅基流动 SenseVoice 语音转文字 API
 * 端点: POST https://api.siliconflow.cn/v1/audio/transcriptions
 * 模型: FunAudioLLM/SenseVoiceSmall
 * 文档: https://docs.siliconflow.cn/docs/api/audio-transcriptions-post
 */
import fs from "fs";
import type { TranscriptResult, TranscriptSegment } from "./transcriber";

const API_BASE = "https://api.siliconflow.cn/v1/audio/transcriptions";

interface SenseVoiceResponse {
  text: string;
}

/**
 * 将纯文本拆分为模拟分段（按中文标点断句）
 */
function splitTextToSegments(text: string, duration?: number): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  // 按中文/英文标点断句
  const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
  let offset = 0;
  const total = sentences.reduce((sum, sentence) => sum + sentence.trim().length, 0);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    // 有已知总时长时按字符比例分配；否则使用保守语速估算。
    const charCount = trimmed.length;
    const estimatedDuration = duration && Number.isFinite(duration) && duration > 0 ? duration * charCount / total : Math.max(0.5, charCount / 4);
    segments.push({
      start: offset,
      end: offset + estimatedDuration,
      text: trimmed,
    });
    offset += estimatedDuration;
  }
  return segments;
}

/**
 * 使用硅基流动 SenseVoice 转写音频
 */
export async function transcribeWithSenseVoice(
  audioPath: string,
  onProgress?: (percent: number) => void,
  options?: { allowEmpty?: boolean; timeoutMs?: number; duration?: number },
): Promise<TranscriptResult> {
  const apiKey = process.env.SENSEVOICE_API_KEY;
  if (!apiKey) {
    throw new Error("SENSEVOICE_API_KEY 未配置");
  }

  onProgress?.(10);

  const fileBuffer = await fs.promises.readFile(audioPath);
  const fileName = audioPath.split(/[/\\]/).pop() || "audio.wav";

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);
  formData.append("model", "FunAudioLLM/SenseVoiceSmall");

  onProgress?.(30);

  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(options?.timeoutMs ?? 120_000),
  });

  onProgress?.(60);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误");
    throw new Error(`SenseVoice API 错误 (${response.status}): ${errorText}`);
  }

  const data: SenseVoiceResponse = await response.json();

  onProgress?.(80);

  if (!data.text || !data.text.trim()) {
    if (options?.allowEmpty) return { text: "", segments: [], source: "whisper", transcription: { provider: "sensevoice", timing: "estimated" } };
    throw new Error("该视频没有检测到语音内容");
  }

  const segments = splitTextToSegments(data.text, options?.duration);

  onProgress?.(100);

  return {
    text: data.text,
    segments,
    source: "whisper", // 保留旧字段兼容；实际来源与估算精度单独传递
    transcription: { provider: "sensevoice", timing: "estimated" },
  };
}
