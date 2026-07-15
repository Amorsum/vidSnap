/**
 * 硅基流动 SenseVoice 语音转文字 API
 * 端点: POST https://api.siliconflow.cn/v1/audio/transcriptions
 * 模型: FunAudioLLM/SenseVoiceSmall
 * 文档: https://docs.siliconflow.cn/cn/api-reference/audio/create-audio-transcriptions
 */
import fs from "fs";
import path from "path";
import type { TranscriptResult, TranscriptSegment } from "./transcriber";

const API_BASE = "https://api.siliconflow.cn/v1/audio/transcriptions";

interface SenseVoiceResponse {
  text: string;
}

/**
 * 将纯文本拆分为模拟分段（按中文标点断句）
 */
function splitTextToSegments(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
  let offset = 0;
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const charCount = trimmed.length;
    const estimatedDuration = Math.max(0.5, charCount / 4);
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
 * 手动构造 multipart/form-data 请求体（兼容 Node.js 服务端环境）
 */
async function buildMultipartBody(
  filePath: string,
  model: string
): Promise<{ body: Buffer; boundary: string }> {
  const boundary = `----FormBoundary${Date.now()}`;
  const fileName = path.basename(filePath);
  const fileBuffer = await fs.promises.readFile(filePath);
  const mimeType = fileName.endsWith(".m4a")
    ? "audio/mp4"
    : fileName.endsWith(".mp3")
      ? "audio/mpeg"
      : fileName.endsWith(".wav")
        ? "audio/wav"
        : "audio/mpeg";

  const parts: Buffer[] = [];
  const crlf = "\r\n";

  // file 字段
  parts.push(Buffer.from(`--${boundary}${crlf}`));
  parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}`));
  parts.push(Buffer.from(`Content-Type: ${mimeType}${crlf}${crlf}`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(crlf));

  // model 字段
  parts.push(Buffer.from(`--${boundary}${crlf}`));
  parts.push(Buffer.from(`Content-Disposition: form-data; name="model"${crlf}${crlf}`));
  parts.push(Buffer.from(model));
  parts.push(Buffer.from(crlf));

  // 结束
  parts.push(Buffer.from(`--${boundary}--${crlf}`));

  return {
    body: Buffer.concat(parts),
    boundary,
  };
}

/**
 * 使用硅基流动 SenseVoice 转写音频
 */
export async function transcribeWithSenseVoice(
  audioPath: string,
  onProgress?: (percent: number) => void
): Promise<TranscriptResult> {
  const apiKey = process.env.SENSEVOICE_API_KEY;
  if (!apiKey) {
    throw new Error("SENSEVOICE_API_KEY 未配置");
  }

  onProgress?.(10);

  const { body, boundary } = await buildMultipartBody(audioPath, "FunAudioLLM/SenseVoiceSmall");

  onProgress?.(30);

  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  onProgress?.(60);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "未知错误");
    throw new Error(`SenseVoice API 错误 (${response.status}): ${errorText}`);
  }

  const data: SenseVoiceResponse = await response.json();

  onProgress?.(80);

  if (!data.text || !data.text.trim()) {
    throw new Error("该视频没有检测到语音内容");
  }

  const segments = splitTextToSegments(data.text);

  onProgress?.(100);

  return {
    text: data.text,
    segments,
    source: "whisper",
  };
}