import { NextRequest, NextResponse } from "next/server";
import { cleanupTempFiles, type VideoInfo, type ProcessResult } from "@/lib/video-processor";
import { getTranscript, parseBuiltinSubtitle, type TranscriptResult } from "@/lib/transcriber";
import { transcribeWithSenseVoice } from "@/lib/sensevoice";
import { isValidUrl, UNSUPPORTED_PLATFORM_MESSAGE } from "@/lib/url-utils";
import { getProcessor } from "@/lib/platforms";
import { callLLMStreaming } from "@/lib/llm";
import type { TokenUsage } from "@/lib/llm";
import { calcCost } from "@/lib/observability";
import { SUMMARIZE_SYSTEM_PROMPT, formatTranscriptForPrompt } from "@/lib/prompts";
import { saveTranscript } from "@/lib/transcript-store";
import { tryEmbedSegments } from "@/lib/embeddings";
import { getCachedResult, cacheResult } from "@/lib/process-cache";
import { verifyAccessCode, getClientIp, checkRateLimit } from "@/lib/security";
import { existsSync } from "fs";

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

function parseAIJSON<T>(text: string): T {
  const trimmed = text.trim();
  // json mode 下基本不会有多余包裹，但保险起见去除 markdown 代码块
  const mdMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const raw = mdMatch ? mdMatch[1].trim() : trimmed;
  return JSON.parse(raw) as T;
}

// ─── 智能转写：云 API 优先，本地降级 ───

async function getTranscriptSmart(
  processResult: ProcessResult,
  send: (data: unknown) => void,
  options?: { model?: string }
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
      console.log("[sensevoice] 云端转写失败，降级到本地 Whisper:", err);
    }
  }

  // 本地 Whisper 降级
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
  info: VideoInfo,
  transcript: TranscriptResult,
  send: (data: unknown) => void,
): Promise<{ result: Record<string, unknown>; usage: TokenUsage | null; latencyMs: number }> {
  const summarizeStart = Date.now();
  send({ type: "stream_start" });

  const transcriptText = formatTranscriptForPrompt(transcript.segments);
  const durationMin = Math.round(info.duration / 60);
  const userMessage = `视频标题：${info.title}
视频时长：${info.duration}秒（约${durationMin}分钟）
上传者：${info.uploader}

以下是视频字幕（带时间戳）：

${transcriptText}`;

  let fullText = "";
  let usage: TokenUsage | null = null;
  const maxTokens = info.duration < 180 ? 4000 : 6000;

  // 估算输入 token 数来推算总输出 token 数
  const estimatedInputTokens = Math.ceil(transcriptText.length / 2);
  const estimatedOutputTokens = Math.min(maxTokens, Math.max(500, estimatedInputTokens / 3));
  let tokenCount = 0;

  for await (const chunk of callLLMStreaming(SUMMARIZE_SYSTEM_PROMPT, userMessage, {
    maxTokens,
    jsonMode: true,
    onUsage: (u) => { usage = u; },
  })) {
    fullText += chunk;
    tokenCount += chunk.length; // 粗略估算
    send({ type: "stream", text: chunk });

    // LLM 进度：70-95%
    const subPercent = Math.min(100, Math.round((tokenCount / estimatedOutputTokens) * 100));
    send(progress("analyzing", mapPhaseProgress("analyzing", subPercent)));
  }

  send({ type: "stream_end" });

  const aiResult = parseAIJSON<Record<string, unknown>>(fullText);
  const latencyMs = Date.now() - summarizeStart;

  // 生成 embedding（失败降级，不影响主流程）
  const transcriptEmbeddings = await tryEmbedSegments(transcript.segments);

  saveTranscript(info.id, transcript.segments, info, transcriptEmbeddings);
  cacheResult(info.id, {
    video: info,
    transcriptSource: transcript.source,
    transcriptText: transcript.text,
    transcriptSegments: transcript.segments,
    transcriptEmbeddings,
    result: aiResult,
  });

  return { result: aiResult, usage, latencyMs };
}

// ─── POST 处理器 ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) {
      return NextResponse.json({ success: false, error: "请提供视频链接" }, { status: 400 });
    }

    if (!isValidUrl(url)) {
      return NextResponse.json({ success: false, error: UNSUPPORTED_PLATFORM_MESSAGE }, { status: 400 });
    }

    // 访问码门禁
    if (!verifyAccessCode(request.headers.get("x-access-code"))) {
      return NextResponse.json(
        { success: false, error: "需要访问码，请向站长获取" },
        { status: 401 }
      );
    }

    // 每 IP 限流：10 分钟最多 10 次处理（保护 API Key 不被刷爆）
    const ip = getClientIp(request);
    const rl = checkRateLimit(`process:${ip}`, 10, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(sseEvent(data)));
        };

        // 心跳机制：防止 Cloudflare 隧道 / 代理超时断开 SSE 连接
        const heartbeatInterval = setInterval(() => {
          send({ type: "heartbeat" });
        }, 15000);

        // info 声明在 try 外：catch 分支需要用它清理临时文件
        let info: VideoInfo | undefined;

        try {
          let transcript: TranscriptResult;
          let aiResult: Record<string, unknown>;
          let summarizeUsage: TokenUsage | null = null;
          let summarizeLatencyMs = 0;
          const totalStart = Date.now();

          // 统一处理：先轻量提取视频信息（不下载媒体）
          send(progress("downloading", 0));
          const processor = getProcessor(url);
          info = await processor.getInfo(url);
          send(progress("downloading", 10));

          // 缓存优先：命中则完全跳过下载与转写（快速路径，避免重复下载浪费）
          const cached = getCachedResult(info.id);
          if (cached) {
            send(progress("downloading", 100));
            transcript = {
              text: cached.transcriptText,
              segments: cached.transcriptSegments,
              source: cached.transcriptSource,
            };
            aiResult = cached.result;
            saveTranscript(info.id, transcript.segments, info, cached.transcriptEmbeddings);
          } else {
            // 缓存未命中才下载（字幕优先或音频）
            const downloadResult = await processor.download(url, info);
            send(progress("downloading", 100));

            // 转写：字幕优先，否则下载音频转写
            if (downloadResult.subtitlePath && existsSync(downloadResult.subtitlePath)) {
              transcript = await parseBuiltinSubtitle(downloadResult.subtitlePath);
            } else {
              // 短视频用 tiny 模型提速（仅抖音；YouTube 保持默认模型保证转写质量）
              const isShortVideo = info.duration < 180;
              const model = processor.useTinyForShortVideos && isShortVideo && process.env.WHISPER_MODEL !== "tiny" ? "tiny" : undefined;
              transcript = await getTranscriptSmart(downloadResult, send, { model });
            }

            if (transcript.segments.length === 0) {
              await cleanupTempFiles(info.id);
              send({ type: "error", message: "该视频没有检测到语音内容（可能是纯音乐或无声视频），无法生成文字总结" });
              controller.close();
              return;
            }

            send(progress("analyzing", mapPhaseProgress("analyzing", 0)));
            const summary = await doAISummarize(info, transcript, send);
            aiResult = summary.result;
            summarizeUsage = summary.usage;
            summarizeLatencyMs = summary.latencyMs;
            await cleanupTempFiles(info.id);
          }

          // 收尾
          send(progress("done", 100));

          const totalMs = Date.now() - totalStart;
          const cost = summarizeUsage ? calcCost(summarizeUsage) : null;
          if (summarizeUsage && cost !== null) {
            console.log(
              `[metrics] ${info.id} 总结完成: token ${summarizeUsage.totalTokens} (in ${summarizeUsage.promptTokens}/out ${summarizeUsage.completionTokens}), 总耗时 ${totalMs}ms (总结 ${summarizeLatencyMs}ms), 成本 ¥${cost.toFixed(4)}`
            );
          }

          send({
            type: "result",
            data: {
              video: info,
              transcriptSource: transcript.source,
              transcriptText: transcript.text,
              transcriptSegments: transcript.segments,
              result: aiResult,
              cached: !!cached,
              metrics: {
                totalMs,
                summarizeMs: summarizeLatencyMs,
                usage: summarizeUsage,
                cost,
              },
            },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "处理失败，请稍后重试";
          send({ type: "error", message });
          // 异常分支也要清理已下载的临时文件，防止磁盘泄漏
          if (info) {
            await cleanupTempFiles(info.id);
          }
        } finally {
          clearInterval(heartbeatInterval);
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
  if (!verifyAccessCode(request.headers.get("x-access-code"))) {
    return NextResponse.json(
      { success: false, error: "需要访问码，请向站长获取" },
      { status: 401 }
    );
  }
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