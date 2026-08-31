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
import { tryEmbedSegments } from "@/lib/embeddings";
import { getCachedResult, cacheResult, invalidateCache } from "@/lib/process-cache";
import { saveTranscript, removeTranscript } from "@/lib/transcript-store";
import { clearConversation } from "@/lib/conversation-store";
import { verifyAccessCode, getClientIp, checkRateLimit } from "@/lib/security";
import { extractKeyframes, scheduleFramesCleanup, sweepExpiredFrames, cleanupFrameFiles } from "@/lib/keyframes";
import {
  isVisionEnabled, describeFrames, formatFramePrompt, signFrameToken,
  type FrameDescription, type FrameInfo,
} from "@/lib/vision";
import { existsSync } from "fs";

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ─── 进度区间映射 ───
// 0-20%: 下载
// 20-60%: 转写（Whisper 上报 0-100 → 映射到 20-60）
// 60-75%: 视觉理解（关键帧抽取 + 视觉模型描述，失败静默跳过）
// 75-95%: AI 总结（LLM 流式 token 估算 → 映射到 75-95）
// 95-100%: 收尾

function progress(step: string, percent: number) {
  return { type: "progress", step, percent };
}

function mapPhaseProgress(phase: "downloading" | "transcribing" | "vision" | "analyzing", subPercent: number): number {
  switch (phase) {
    case "downloading": return Math.round(5 + (subPercent / 100) * 15);      // 5-20%
    case "transcribing": return Math.round(20 + (subPercent / 100) * 40);    // 20-60%
    case "vision":       return Math.round(60 + (subPercent / 100) * 15);    // 60-75%
    case "analyzing":    return Math.round(75 + (subPercent / 100) * 20);    // 75-95%
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

// ─── 辅助：视觉理解阶段（抽关键帧 → 视觉模型描述，失败降级音频-only） ───

async function doVisionPhase(
  url: string,
  info: VideoInfo,
  downloadResult: ProcessResult,
  processor: ReturnType<typeof getProcessor>,
  send: (data: unknown) => void,
): Promise<{
  descriptions: FrameDescription[];
  frameInfos: FrameInfo[];
  usage: TokenUsage | null;
} | null> {
  if (!isVisionEnabled() || !info.duration) return null;

  send(progress("vision", mapPhaseProgress("vision", 0)));
  try {
    // 抖音在 download 阶段已保留 mp4；YouTube 按需下载低清流
    let videoPath = downloadResult.videoPath ?? null;
    if (!videoPath) {
      if (!processor.downloadVideo) return null;
      videoPath = await processor.downloadVideo(url, info);
    }

    const frames = await extractKeyframes(videoPath, info.id, info.duration);
    await sweepExpiredFrames();
    send(progress("vision", mapPhaseProgress("vision", 60)));

    const vision = await describeFrames(frames, info.title);
    if (!vision) return null;

    const frameInfos: FrameInfo[] = await Promise.all(
      vision.descriptions.map(async (d, i) => ({
        time: d.time,
        description: d.description,
        src: `/api/frames?videoId=${info.id}&idx=${i + 1}&token=${await signFrameToken(info.id, i + 1)}`,
      }))
    );

    scheduleFramesCleanup(info.id);
    send(progress("vision", mapPhaseProgress("vision", 100)));
    return { descriptions: vision.descriptions, frameInfos, usage: vision.usage };
  } catch (err) {
    console.log("[vision] 视觉阶段失败，降级为音频-only:", err);
    return null;
  }
}

// ─── 辅助：AI 总结 + 缓存 ───

async function doAISummarize(
  info: VideoInfo,
  transcript: TranscriptResult,
  send: (data: unknown) => void,
  vision?: { descriptions: FrameDescription[]; frameInfos: FrameInfo[] },
): Promise<{ result: Record<string, unknown>; usage: TokenUsage | null; latencyMs: number }> {
  const summarizeStart = Date.now();
  send({ type: "stream_start" });

  const transcriptText = formatTranscriptForPrompt(transcript.segments);
  const durationMin = Math.round(info.duration / 60);
  const visionBlock = vision
    ? `以下是从视频画面抽取的关键帧视觉描述（画面可与字幕互补；字幕与画面冲突时以画面为准；画面时间戳与字幕可能有 ±5 秒偏差，请按语义就近对齐；画面补充的要点同样绑定对应画面时间戳）：

${formatFramePrompt(vision.descriptions)}`
    : null;

  const userMessage = `视频标题：${info.title}
视频时长：${info.duration}秒（约${durationMin}分钟）
上传者：${info.uploader}

以下是视频字幕（带时间戳）：

${transcriptText}${visionBlock ? `\n\n${visionBlock}` : ""}`;

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
    frames: vision?.frameInfos,
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
        // 客户端断开后 controller 已关闭，后续写入会抛「Invalid state」——守卫防 uncaughtException
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(sseEvent(data)));
          } catch {
            // 客户端已断开，忽略后续写入
          }
        };

        // 心跳机制：防止 Cloudflare 隧道 / 代理超时断开 SSE 连接
        const heartbeatInterval = setInterval(() => {
          send({ type: "heartbeat" });
        }, 15000);

        // 客户端断开（请求 abort）时立即关闭流，释放 SSE 资源
        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval);
          try {
            controller.close();
          } catch {
            // 已关闭则忽略
          }
        });

        // info 声明在 try 外：catch 分支需要用它清理临时文件
        let info: VideoInfo | undefined;

        try {
          let transcript: TranscriptResult;
          let aiResult: Record<string, unknown>;
          let summarizeUsage: TokenUsage | null = null;
          let summarizeLatencyMs = 0;
          let frameInfos: FrameInfo[] | undefined;
          let visionUsage: TokenUsage | null = null;
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
            frameInfos = cached.frames;
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

            // 视觉理解：抽关键帧 → 视觉模型描述（失败静默降级为音频-only）
            const vision = await doVisionPhase(url, info, downloadResult, processor, send);
            if (vision) {
              frameInfos = vision.frameInfos;
              visionUsage = vision.usage;
            }

            send(progress("analyzing", mapPhaseProgress("analyzing", 0)));
            const summary = await doAISummarize(info, transcript, send, vision ?? undefined);
            aiResult = summary.result;
            summarizeUsage = summary.usage;
            summarizeLatencyMs = summary.latencyMs;
            await cleanupTempFiles(info.id);
          }

          // 收尾
          send(progress("done", 100));

          const totalMs = Date.now() - totalStart;
          const cost = summarizeUsage ? calcCost(summarizeUsage) : null;
          const visionCost = visionUsage ? calcCost(visionUsage, "siliconflow-vl") : null;
          if (summarizeUsage && cost !== null) {
            console.log(
              `[metrics] ${info.id} 总结完成: token ${summarizeUsage.totalTokens} (in ${summarizeUsage.promptTokens}/out ${summarizeUsage.completionTokens}), 总耗时 ${totalMs}ms (总结 ${summarizeLatencyMs}ms), 成本 ¥${cost.toFixed(4)}`
            );
          }
          if (visionUsage && visionCost !== null) {
            console.log(
              `[metrics] ${info.id} 视觉理解: token ${visionUsage.totalTokens} (in ${visionUsage.promptTokens}/out ${visionUsage.completionTokens}), 成本 ¥${visionCost.toFixed(4)}`
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
              frames: frameInfos ?? [],
              metrics: {
                totalMs,
                summarizeMs: summarizeLatencyMs,
                usage: summarizeUsage,
                cost,
                visionUsage,
                visionCost,
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
          try {
            controller.close();
          } catch {
            // 客户端断开时已在 abort 监听中关闭
          }
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
    await cleanupFrameFiles(videoId);
    // 同步失效内存态数据，避免缓存命中返回悬空帧引用、追问残留旧数据
    invalidateCache(videoId);
    removeTranscript(videoId);
    clearConversation(videoId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "清理失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}