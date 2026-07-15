import { callLLMWithPrompt } from "./llm";
import type { TranscriptSegment } from "./transcriber";
import type { VideoInfo } from "./video-processor";
import {
  SUMMARIZE_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  formatTranscriptForPrompt,
} from "./prompts";

// ─── 类型定义 ───

export interface SummaryPoint {
  time: string; // "MM:SS" 格式
  text: string;
}

export interface SummarySegment {
  title: string;
  start: number;
  end: number;
  points: SummaryPoint[];
}

export interface SummaryResult {
  overall: string;
  videoType?: string;
  segments: SummarySegment[];
}

export interface KeyInfoItem {
  time: string;
  text: string;
}

export interface KeyInfoResult {
  videoType: string;
  items: KeyInfoItem[];
  summary: string;
}

export interface TranslatePair {
  time: string;
  original: string;
  translated: string;
}

export interface TranslateResult {
  segments: TranslatePair[];
  overallTranslation: string;
}

/**
 * 安全解析 LLM 返回的 JSON（可能被 markdown code block 包裹）
 */
function parseJSONResponse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      return JSON.parse(match[1].trim()) as T;
    }
    throw new Error(`无法解析 AI 响应为 JSON: ${text.slice(0, 200)}...`);
  }
}

// ─── 视频总结 ───

export async function summarizeVideo(
  segments: TranscriptSegment[],
  videoInfo: VideoInfo
): Promise<SummaryResult> {
  const transcript = formatTranscriptForPrompt(segments);
  const durationMin = Math.round(videoInfo.duration / 60);

  const userMessage = `视频标题：${videoInfo.title}
视频时长：${videoInfo.duration}秒（约${durationMin}分钟）
上传者：${videoInfo.uploader}

以下是视频字幕（带时间戳）：

${transcript}`;

  const text = await callLLMWithPrompt(SUMMARIZE_SYSTEM_PROMPT, userMessage, {
    maxTokens: 2000,
  });

  return parseJSONResponse<SummaryResult>(text);
}

// ─── 关键信息提取 ───

export async function extractKeyInfo(
  segments: TranscriptSegment[],
  query: string,
  videoInfo: VideoInfo
): Promise<KeyInfoResult> {
  const transcript = formatTranscriptForPrompt(segments);

  const userMessage = `视频标题：${videoInfo.title}
上传者：${videoInfo.uploader}

以下是视频字幕（带时间戳）：

${transcript}

用户关注点：${query}`;

  const text = await callLLMWithPrompt(EXTRACT_SYSTEM_PROMPT, userMessage, {
    maxTokens: 2000,
  });

  return parseJSONResponse<KeyInfoResult>(text);
}

// ─── 翻译 ───

export async function translateVideo(
  segments: TranscriptSegment[],
  _targetLang: string,
  videoInfo: VideoInfo
): Promise<TranslateResult> {
  const transcript = formatTranscriptForPrompt(segments);

  const userMessage = `视频标题：${videoInfo.title}
原始语言：请自动检测
目标语言：中文

以下是视频字幕（带时间戳）：

${transcript}`;

  const text = await callLLMWithPrompt(TRANSLATE_SYSTEM_PROMPT, userMessage, {
    maxTokens: 4000,
  });

  return parseJSONResponse<TranslateResult>(text);
}

// ─── 追问 ───

export async function followUpQuestion(
  segments: TranscriptSegment[],
  question: string,
  videoInfo: VideoInfo,
  previousContext?: string
): Promise<string> {
  const transcript = formatTranscriptForPrompt(segments);

  let context = "";
  if (previousContext) {
    context = `之前的总结/回答：${previousContext}\n\n`;
  }

  const userMessage = `视频标题：${videoInfo.title}

${context}视频字幕（带时间戳）：

${transcript}

用户问题：${question}`;

  return callLLMWithPrompt(FOLLOWUP_SYSTEM_PROMPT, userMessage, {
    maxTokens: 1000,
  });
}