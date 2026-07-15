import { NextRequest, NextResponse } from "next/server";
import { downloadAudio, cleanupTempFiles, tryDownloadSubtitles, extractVideoInfo } from "@/lib/video-processor";
import { getTranscript, parseBuiltinSubtitle, type TranscriptResult } from "@/lib/transcriber";
import { transcribeWithSenseVoice } from "@/lib/sensevoice";
import { isValidUrl, detectPlatform } from "@/lib/url-utils";
import { callLLMStreaming } from "@/lib/llm";
import { SUMMARIZE_SYSTEM_PROMPT, formatTranscriptForPrompt } from "@/lib/prompts";
import { saveTranscript } from "@/lib/transcript-store";
import { getCachedResult, cacheResult } from "@/lib/process-cache";
import { existsSync } from "fs";
import type { ProcessResult } from "@/lib/video-processor";

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ─── 进度区间映射 ───
// 0-25%: 下载
// 25-70%: 转写（Whisper 上报 0-100 → 映射到 25-70）
// 70-95%: AI 总结（LLM 流式 token 估算 → 映射到 70-95）
// 95-100%: 收尾

function progress(step: string, percent: number) {
  return { type: "progress", step, percent };
}

function mapPhaseProgress(phase: "downloading" | "transcribing" | "analyzing", subPercent: number): number {
  switch (phase) {
    case "downloading": return Math.round(5 + (subPercent / 100) * 20);      // 5-25%
    case "transcribing": return Math.round(25 + (subPercent / 100) * 45);    // 25-70%
    case "analyzing":    return Math.round(70 + (subPercent / 100) * 25);    // 70-95%
    default: return 0;
  }
}

function parseJSONResponse<T>(text: string): T {
  let cleaned = text;
  const mdMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (mdMatch) cleaned = mdMatch[1].trim();
  
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    try {
      const fixed = fixTruncatedJSON(cleaned);
      return JSON.parse(fixed) as T;
    } catch {
      const lastComma = cleaned.lastIndexOf(",");
      if (lastComma > 0) {
        try {
          const partial = cleaned.slice(0, lastComma);
          const fixed = fixTruncatedJSON(partial) + " ] }";
          return JSON.parse(fixed) as T;
        } catch { /* 放弃 */ }
      }
      throw new Error(`无法解析 AI 响应: ${cleaned.slice(0, 200)}...`);
    }
  }
}

function fixTruncatedJSON(text: string): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"' && !inString) { inString = true; continue; }
    if (ch === '"' && inString) { inString = false; continue; }
    if (inString) continue;
    
    if (ch === "{" || ch === "[") {
      depth++;
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      depth--;
      stack.pop();
    }
  }
  
  let result = text;
  if (inString) result += '"';
  return result + stack.reverse().join("");
}

// ─── 智能转写：云 API 优先，本地降级 ───

async function getTranscriptSmart(
  processResult: ProcessResult,
  send: (data: unknown) => void,
  options?: { model?: string; isShortVideo?: boolean }
): Promise<TranscriptResult> {
  const hasCloudKey = !!process.env.SENSEVOICE_API_KEY;

  if (hasCloudKey) {
    // 云端 SenseVoice 转写（快、准、免 GPU）
    send(progress("transcribing", mapPhaseProgress("transcribing", 0)));
    try {
      const result = await transcribeWithSenseVoice(
        processResult.audioPath,
        (subPercent) => {
          send(progress("transcribing", mapPhaseProgress("transcribing", subPercent)));
        }
      );
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log("[sensevoice] 云端转写失败:", errMsg);
      throw new Error(`云端转写失败: ${errMsg}`);
    }
  }

  // 本地 Whisper 降级（仅本地开发环境）
  const onWhisperProgress = (subPercent: number) => {
    send(progress("transcribing", mapPhaseProgress("transcribing", subPercent)));
  };
  send(progress("transcribing", mapPhaseProgress("transcribing", 0)));
  return getTranscript(processResult, {
    model: options?.model,
    onProgress: onWhisperProgress,
  });
}

// ─── 辅助：AI 总结 + 缓存 ───

async function doAISummarize(
  info: { id: string; title: string; duration: number; thumbnail: string; uploader: string },
  transcript: { text: string; segments: { start: number; end: number; text: string }[]; source: "builtin" | "whisper" },
  send: (data: unknown) => void,
): Promise<Record<string, unknown>> {
  send({ type: "stream_start" });

  const transcriptText = formatTranscriptForPrompt(transcript.segments);
  const durationMin = Math.round(info.duration / 60);
  const userMessage = `视频标题：${info.title}
视频时长：${info.duration}秒（约${durationMin}分钟）
上传者：${info.uploader}

以下是视频字幕（带时间戳）：

${transcriptText}`;

  let fullText = "";
  const maxTokens = info.duration < 180 ? 4000 : 6000;

  // 估算输入 token 数来推算总输出 token 数
  const estimatedInputTokens = Math.ceil(transcriptText.length / 2);
  const estimatedOutputTokens = Math.min(maxTokens, Math.max(500, estimatedInputTokens / 3));
  let tokenCount = 0;

  for await (const chunk of callLLMStreaming(SUMMARIZE_SYSTEM_PROMPT, userMessage, { maxTokens })) {
    fullText += chunk;
    tokenCount += chunk.length; // 粗略估算
    send({ type: "stream", text: chunk });

    // LLM 进度：70-95%
    const subPercent = Math.min(100, Math.round((tokenCount / estimatedOutputTokens) * 100));
    send(progress("analyzing", mapPhaseProgress("analyzing", subPercent)));
  }

  send({ type: "stream_end" });

  const aiResult = parseJSONResponse<Record<string, unknown>>(fullText);

  saveTranscript(info.id, transcript.segments, info);
  cacheResult(info.id, {
    video: info,
    transcriptSource: transcript.source,
    transcriptText: transcript.text,
    transcriptSegments: transcript.segments,
    result: aiResult,
  });

  return aiResult;
}

// ─── POST 处理器 ───

export async function POST(request: NextRequest) {
  try {
    console.log("[vidSnap] SENSEVOICE_API_KEY present:", !!process.env.SENSEVOICE_API_KEY);
    console.log("[vidSnap] DEEPSEEK_API_KEY present:", !!process.env.DEEPSEEK_API_KEY);
    
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) {
      return NextResponse.json({ success: false, error: "请提供视频链接" }, { status: 400 });
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ success: false, error: "目前仅支持 YouTube 和抖音链接" }, { status: 400 });
    }

    const platform = detectPlatform(url);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(sseEvent(data)));
        };

        try {
          let info: { id: string; title: string; duration: number; thumbnail: string; uploader: string };
          let transcript: { text: string; segments: { start: number; end: number; text: string }[]; source: "builtin" | "whisper" };
          let aiResult: Record<string, unknown>;
          let cached;

          if (platform === "youtube") {
            // ─── YouTube：提前提取信息，检查缓存 ───
            send(progress("downloading", 0));
            info = await extractVideoInfo(url);
            send(progress("downloading", 10));
            cached = getCachedResult(info.id);

            if (cached) {
              send(progress("downloading", 100));
              transcript = {
                text: cached.transcriptText,
                segments: cached.transcriptSegments,
                source: cached.transcriptSource,
              };
              aiResult = cached.result;
              saveTranscript(info.id, transcript.segments, info);
            } else {
              const subtitleResult = await tryDownloadSubtitles(url);
              info = subtitleResult.info;
              send(progress("downloading", 100));

              if (subtitleResult.subtitlePath && existsSync(subtitleResult.subtitlePath)) {
                transcript = await parseBuiltinSubtitle(subtitleResult.subtitlePath);
              } else {
                // 下载音频
                const processResult = await downloadAudio(url);
                info = processResult.info;

                // 智能转写：SenseVoice 云 API 优先，本地 Whisper 降级
                transcript = await getTranscriptSmart(processResult, send);
              }

              if (transcript.segments.length === 0) {
                await cleanupTempFiles(info.id);
                send({ type: "error", message: "该视频没有检测到语音内容（可能是纯音乐或无声视频），无法生成文字总结" });
                controller.close();
                return;
              }

              send(progress("analyzing", mapPhaseProgress("analyzing", 0)));
              aiResult = await doAISummarize(info, transcript, send);
              await cleanupTempFiles(info.id);
            }
          } else {
            // ─── 抖音：下载音频（Playwright 提取信息），然后检查缓存 ───
            send(progress("downloading", 0));
            const processResult = await downloadAudio(url);
            info = processResult.info;
            send(progress("downloading", 100));

            cached = getCachedResult(info.id);
            if (cached) {
              transcript = {
                text: cached.transcriptText,
                segments: cached.transcriptSegments,
                source: cached.transcriptSource,
              };
              aiResult = cached.result;
              saveTranscript(info.id, transcript.segments, info);
            } else {
              const isShortVideo = info.duration < 180;
              const model = isShortVideo && process.env.WHISPER_MODEL !== "tiny" ? "tiny" : undefined;

              // 智能转写：SenseVoice 云 API 优先，本地 Whisper 降级
              transcript = await getTranscriptSmart(processResult, send, { model, isShortVideo });

              if (transcript.segments.length === 0) {
                await cleanupTempFiles(info.id);
                send({ type: "error", message: "该视频没有检测到语音内容（可能是纯音乐或无声视频），无法生成文字总结" });
                controller.close();
                return;
              }

              send(progress("analyzing", mapPhaseProgress("analyzing", 0)));
              aiResult = await doAISummarize(info, transcript, send);
              await cleanupTempFiles(info.id);
            }
          }

          // 收尾
          send(progress("done", 100));

          send({
            type: "result",
            data: {
              video: {
                id: info.id,
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnail,
                uploader: info.uploader,
              },
              transcriptSource: transcript.source,
              transcriptText: transcript.text,
              transcriptSegments: transcript.segments,
              result: aiResult,
              cached: !!cached,
            },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "处理失败，请稍后重试";
          send({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { videoId } = await request.json() as { videoId?: string };
    if (!videoId) {
      return NextResponse.json({ success: false, error: "请提供 videoId" }, { status: 400 });
    }
    await cleanupTempFiles(videoId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "清理失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}