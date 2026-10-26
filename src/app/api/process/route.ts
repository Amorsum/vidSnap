import { NextRequest, NextResponse } from "next/server";
import { type VideoInfo, type ProcessResult } from "@/lib/video-processor";
import { getTranscript, parseBuiltinSubtitle, type TranscriptResult } from "@/lib/transcriber";
import { transcribeWithSenseVoice } from "@/lib/sensevoice";
import { parseVideoUrl, UNSUPPORTED_PLATFORM_MESSAGE } from "@/lib/url-utils";
import { getProcessor } from "@/lib/platforms";
import { callLLMStreaming } from "@/lib/llm";
import type { TokenUsage } from "@/lib/llm";
import { calcCost } from "@/lib/observability";
import { SUMMARIZE_SYSTEM_PROMPT, formatTranscriptForPrompt } from "@/lib/prompts";
import { tryEmbedSegments } from "@/lib/embeddings";
import { getCachedResult, cacheResult, invalidateCache } from "@/lib/process-cache";
import { saveTranscript, removeTranscript, getTranscript as getStoredTranscript } from "@/lib/transcript-store";
import { clearConversation } from "@/lib/conversation-store";
import { guardApiRequest } from "@/lib/security";
import { readJsonObject, isValidVideoId, RequestValidationError, ServiceCapacityError } from "@/lib/request-validation";
import { extractKeyframes } from "@/lib/keyframes";
import { ensureSession, getSessionId } from "@/lib/session";
import {
  ARTIFACT_TTL_MS, createAnalysis, findReusableAnalysis, getOwnedAnalysis, getOwnedAnalysisById, isAnalysisId,
  assertAnalysisActive, completeAnalysis, revokeAnalysis, type Analysis,
} from "@/lib/analysis-store";
import { analysisDirectory, ensureAnalysisDirectories, cleanupAnalysisArtifacts, scheduleAnalysisCleanup, sweepAnalysisArtifacts } from "@/lib/analysis-artifacts";
import {
  isVisionEnabled, describeFrames, formatFramePrompt, signFrameToken,
  type FrameDescription, type FrameInfo, type VisionResult,
} from "@/lib/vision";
import { existsSync } from "fs";
import { whisperFailureMessage } from "@/lib/whisper-client";
import { PipelineTimer } from "@/lib/pipeline-timing";
import { processFlights, type FlightOutcome } from "@/lib/process-flights";
import { isSummaryResult } from "@/lib/learning";
import type { VisionMetadata } from "@/lib/learning-types";
import { VisionBudget, VisionBudgetExceeded, visionTimeoutMs } from "@/lib/vision-budget";

interface VisionStatus {
  outcome: VisionResult["outcome"];
  budgetMs: number;
  describedFrames: number;
  totalFrames: number;
  usageComplete: boolean;
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** 将底层命令错误转为可操作的用户提示，避免把整段 yt-dlp stderr 直接暴露到页面。 */
function getUserFacingProcessError(error: unknown): string {
  const whisperMessage = whisperFailureMessage(error);
  if (whisperMessage) return whisperMessage;
  if (error instanceof ServiceCapacityError) return error.message;
  if (!(error instanceof Error)) return "处理失败，请稍后重试";

  const message = error.message;
  if (/^该分析已删除或过期|^该视频没有检测到语音内容|^等待同视频处理超时|^共享结果已失效|^连接已断开/.test(message)) return message;
  if (/WinError 10013|Failed to establish a new connection|Unable to download (?:webpage|API page)/i.test(message)) {
    return "无法连接 YouTube，请检查服务器网络或代理设置后重试。";
  }
  if (/Sign in to confirm|cookies-from-browser|cookies\.txt|HTTP Error 403/i.test(message)) {
    return "YouTube 要求登录验证，请更新服务器上的 cookies.txt 后重试。";
  }
  if (/Private video|Video unavailable|This video is unavailable/i.test(message)) {
    return "该视频不可用或需要额外访问权限，请确认链接后重试。";
  }
  if (/ENOENT|not recognized as an internal|No such file or directory/i.test(message)) {
    return "服务器未找到 yt-dlp，请检查安装和 PATH 配置。";
  }
  if (/timed?\s*out|ETIMEDOUT/i.test(message)) {
    return "视频解析超时，请检查网络后重试。";
  }

  return "视频解析失败，请检查链接或稍后重试。";
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
  analysis: Analysis,
  send: (data: unknown) => void,
): Promise<{
  descriptions: FrameDescription[];
  frameInfos: FrameInfo[];
  usage: TokenUsage | null;
  status: VisionStatus;
} | null> {
  if (!isVisionEnabled() || !info.duration) return null;

  const budget = new VisionBudget(visionTimeoutMs(), () => performance.now(), () => assertAnalysisActive(analysis));
  let totalFrames = 0;
  send(progress("vision", mapPhaseProgress("vision", 0)));
  try {
    // 抖音在 download 阶段已保留 mp4；YouTube 按需下载低清流
    let videoPath = downloadResult.videoPath ?? null;
    if (!videoPath) {
      if (!processor.downloadVideo) return null;
      videoPath = await processor.downloadVideo(url, info, analysisDirectory(analysis.id, "media"), budget);
    }

    assertAnalysisActive(analysis);
    budget.remainingMs();
    const frames = await extractKeyframes(videoPath, info.id, info.duration, 8, analysisDirectory(analysis.id, "frames"), budget);
    totalFrames = frames.length;
    assertAnalysisActive(analysis);
    analysis.framesExpireAt = Date.now() + ARTIFACT_TTL_MS;
    analysis.expiresAt = Math.max(analysis.expiresAt, analysis.framesExpireAt);
    scheduleAnalysisCleanup(analysis.id, analysis.framesExpireAt, "frames");
    send(progress("vision", mapPhaseProgress("vision", 60)));

    const vision = await describeFrames(frames, info.title, budget);
    assertAnalysisActive(analysis);
    if (!vision) return null;

    const frameInfos: FrameInfo[] = await Promise.all(
      vision.descriptions.map(async (d) => ({
        time: d.time,
        description: d.description,
        src: `/api/frames?videoId=${info.id}&analysisId=${analysis.id}&idx=${d.frameId}&token=${await signFrameToken(analysis.id, d.frameId, analysis.framesExpireAt)}`,
      }))
    );

    send(progress("vision", mapPhaseProgress("vision", 100)));
    return { descriptions: vision.descriptions, frameInfos, usage: vision.usage,
      status: { outcome: vision.outcome, budgetMs: budget.timeoutMs, describedFrames: vision.descriptions.length, totalFrames, usageComplete: vision.usageComplete } };
  } catch (err) {
    // 删除属于整条分析的撤销，不能当作可选视觉降级继续调用模型。
    assertAnalysisActive(analysis);
    const exhausted = err instanceof VisionBudgetExceeded || budget.exhausted;
    console.log(`[vision] 视觉阶段${exhausted ? "预算耗尽" : "失败"}，继续文字总结`);
    return { descriptions: [], frameInfos: [], usage: null,
      status: { outcome: exhausted ? "budget_exhausted" : "failed", budgetMs: budget.timeoutMs, describedFrames: 0, totalFrames, usageComplete: false } };
  }
}

// ─── 辅助：AI 总结 + 缓存 ───

async function doAISummarize(
  info: VideoInfo,
  transcript: TranscriptResult,
  analysis: Analysis,
  send: (data: unknown) => void,
  timer: PipelineTimer,
  vision?: { descriptions: FrameDescription[]; frameInfos: FrameInfo[] },
  visionMetadata?: VisionMetadata,
): Promise<{ result: Record<string, unknown>; usage: TokenUsage | null; latencyMs: number }> {
  let usage: TokenUsage | null = null;
  const aiResult = await timer.measure("summary", async () => {
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
      assertAnalysisActive(analysis);
      if (chunk.length > 0) timer.markFirstToken();
      fullText += chunk;
      tokenCount += chunk.length; // 粗略估算
      send({ type: "stream", text: chunk });

      // LLM 进度：70-95%
      const subPercent = Math.min(100, Math.round((tokenCount / estimatedOutputTokens) * 100));
      send(progress("analyzing", mapPhaseProgress("analyzing", subPercent)));
    }

    send({ type: "stream_end" });

    const result = parseAIJSON<Record<string, unknown>>(fullText);
    assertAnalysisActive(analysis);
    return result;
  });
  timer.markSummaryReady();
  const latencyMs = timer.snapshot().stages.summary!.ms;

  // 生成 embedding（失败降级，不影响主流程）
  // 关键帧视觉描述作为【画面】伪段落存入追问库（带 embedding），
  // 追问三工具可检索画面信息，支持「画面里有什么/这个人是谁」类问题
  if (!isSummaryResult(aiResult)) throw new Error("Invalid summary structure");

  const visionSegments = (vision?.descriptions ?? []).map((d) => ({
    start: d.time,
    end: d.time + 1,
    text: `【画面】${d.description}`,
  }));
  const { transcriptEmbeddings, visionEmbeddings } = await timer.measure("embedding", async () => {
    const transcriptEmbeddings = await tryEmbedSegments(transcript.segments);
    assertAnalysisActive(analysis);
    const visionEmbeddings = visionSegments.length > 0 ? await tryEmbedSegments(visionSegments) : undefined;
    return { transcriptEmbeddings, visionEmbeddings };
  }, (value) => value.transcriptEmbeddings && (visionSegments.length === 0 || value.visionEmbeddings) ? "completed" : "degraded");
  assertAnalysisActive(analysis);

  const combinedSegments = [...transcript.segments, ...visionSegments];
  const combinedEmbeddings = combinedSegments.map((_, i) =>
    i < transcript.segments.length
      ? transcriptEmbeddings?.[i]
      : visionEmbeddings?.[i - transcript.segments.length]
  );

  await timer.measure("persist", () => {
    const expiresAt = completeAnalysis(analysis);
    saveTranscript(analysis.id, combinedSegments, info, combinedEmbeddings, expiresAt);
    cacheResult(analysis.id, {
      video: info,
      transcriptSource: transcript.source,
      transcription: transcript.transcription,
      vision: visionMetadata,
      transcriptText: transcript.text,
      transcriptSegments: transcript.segments,
      transcriptEmbeddings,
      evidenceSegments: combinedSegments.map((segment, i) => ({ ...segment, embedding: combinedEmbeddings[i] })),
      expiresAt,
      result: aiResult,
      frames: vision?.frameInfos,
    });
  });

  return { result: aiResult, usage, latencyMs };
}

// ─── POST 处理器 ───

export async function POST(request: NextRequest) {
  const denied = guardApiRequest(request, "process");
  if (denied) return denied;
  try {
    const { url: inputUrl, resumeOnly, analysisId: resumeAnalysisId } = await readJsonObject(request);
    if ((resumeOnly !== undefined && typeof resumeOnly !== "boolean") || (resumeAnalysisId !== undefined && !isAnalysisId(resumeAnalysisId))) {
      return NextResponse.json({ success: false, error: "恢复参数格式错误" }, { status: 400 });
    }

    if (!inputUrl) {
      return NextResponse.json({ success: false, error: "请提供视频链接" }, { status: 400 });
    }

    const videoUrl = parseVideoUrl(inputUrl);
    if (!videoUrl) {
      return NextResponse.json({ success: false, error: UNSUPPORTED_PLATFORM_MESSAGE }, { status: 400 });
    }

    const url = videoUrl.url;
    const ownerId = getSessionId(request);
    const unavailable = () => NextResponse.json({ success: false, error: "未找到可恢复的分析，任务可能已结束、过期或服务器已重启。请重新分析。" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    if (resumeOnly && !ownerId) return unavailable();
    const session = ownerId ? { id: ownerId } : ensureSession(request);
    const joinedFlight = resumeOnly ? processFlights.join(session.id, videoUrl, resumeAnalysisId) : null;
    const resumeAnalysis = resumeOnly && !joinedFlight
      ? resumeAnalysisId ? getOwnedAnalysisById(session.id, resumeAnalysisId)
        : videoUrl.videoId ? findReusableAnalysis(session.id, videoUrl.platform, videoUrl.videoId) : null
      : null;
    const resumeCache = resumeAnalysis?.platform === videoUrl.platform && (!videoUrl.videoId || resumeAnalysis.videoId === videoUrl.videoId)
      && resumeAnalysis.status === "completed" ? getCachedResult(resumeAnalysis.id) : null;
    if (resumeOnly && !joinedFlight && (!resumeCache || !resumeAnalysis || (resumeAnalysis.contentExpiresAt ?? 0) <= Date.now())) return unavailable();

    const encoder = new TextEncoder();
    const connection = new AbortController();
    const stream = new ReadableStream({
      async start(controller) {
        let flight: ReturnType<typeof processFlights.acquire> | undefined;
        let outcome: FlightOutcome = { error: "处理失败，请稍后重试" };
        // 客户端断开后 controller 已关闭，后续写入会抛「Invalid state」——守卫防 uncaughtException
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(sseEvent(data)));
          } catch {
            // 客户端已断开，忽略后续写入
          }
          if (flight?.leader) flight.publish(data);
        };

        // 心跳机制：防止 Cloudflare 隧道 / 代理超时断开 SSE 连接
        const heartbeatInterval = setInterval(() => {
          send({ type: "heartbeat" });
        }, 15000);

        // 客户端断开（请求 abort）时立即关闭流，释放 SSE 资源
        const onDisconnect = () => {
          clearInterval(heartbeatInterval);
          try {
            controller.close();
          } catch {
            // 已关闭则忽略
          }
        };
        const onAbort = () => connection.abort();
        request.signal.addEventListener("abort", onAbort, { once: true });
        connection.signal.addEventListener("abort", onDisconnect, { once: true });
        if (request.signal.aborted) onAbort();

        // info 声明在 try 外：catch 分支需要用它清理临时文件
        let info: VideoInfo | undefined;
        let analysis: Analysis | undefined;
        const timer = new PipelineTimer();
        let cacheHit = false;
        let shared = false;
        let ownsExecution = false;

        try {
          let transcript: TranscriptResult;
          let aiResult: Record<string, unknown>;
          let summarizeUsage: TokenUsage | null = null;
          let summarizeLatencyMs = 0;
          let frameInfos: FrameInfo[] | undefined;
          let visionUsage: TokenUsage | null = null;
          let visionStatus: VisionStatus | null = null;
          let visionMetadata: VisionMetadata = { outcome: isVisionEnabled() ? "unavailable" : "disabled", describedFrames: 0, totalFrames: 0 };

          // 先查可直接识别的视频缓存，未命中再提取平台元信息。
          send(progress("downloading", 0));
          const processor = getProcessor(url);
          const lookupCache = (videoId: string) => {
            const reusable = findReusableAnalysis(session.id, videoUrl.platform, videoId);
            const cached = reusable ? getCachedResult(reusable.id) : null;
            return { cached, reusable: cached ? reusable : null };
          };
          // 规范链接已有 ID：只复用本会话、同平台且仍有效的内容，无需再次访问平台。
          // 短链接无 ID 时先解析，仍沿用原有解析后查询路径。
          const canonicalId = videoUrl.videoId;
          // 在第一次平台调用前预留执行权；重复连接只等完成结果，不重复消费模型流。
          flight = resumeOnly ? joinedFlight ?? undefined : processFlights.acquire(session.id, videoUrl);
          let cacheState: ReturnType<typeof lookupCache> | undefined;
          if (flight && !flight.leader) {
            shared = true;
            const joined = flight;
            const ready = await timer.measure("inflight_wait", async () => {
              const result = await joined.wait(send, connection.signal);
              if ("error" in result) throw new Error(result.error);
              return result;
            });
            cacheState = await timer.measure("cache_lookup", () => {
              const reusable = getOwnedAnalysis(session.id, ready.videoId, ready.analysisId);
              const cached = reusable?.platform === videoUrl.platform && reusable.status === "completed" ? getCachedResult(reusable.id) : null;
              if (!cached || !reusable || (reusable.contentExpiresAt ?? 0) <= Date.now()) throw new Error("共享结果已失效，请重新处理视频");
              return { cached, reusable };
            });
          } else if (resumeOnly && resumeCache && resumeAnalysis) {
            cacheState = { cached: resumeCache, reusable: resumeAnalysis };
          } else if (canonicalId) {
            cacheState = await timer.measure("cache_lookup", () => lookupCache(canonicalId));
          }
          // 恢复路径不允许回落到元信息、下载、转写或模型调用。
          if (resumeOnly && !cacheState?.cached) throw new Error("共享结果已失效，请重新处理视频");
          info = cacheState?.cached?.video ?? await timer.measure("metadata", async () => {
            const extracted = await processor.getInfo(url);
            if (!isValidVideoId(extracted.id)) throw new Error("视频元信息中的 ID 无效");
            return extracted;
          });
          const resolvedId = info.id;
          // 解析期间其他请求可能已经完成：保留原先解析后复查的复用机会。
          if (!cacheState?.cached) cacheState = await timer.measure("cache_lookup", () => lookupCache(resolvedId));
          const { cached, reusable } = cacheState;
          const currentInfo = info;
          const currentAnalysis = cached && reusable ? reusable : createAnalysis(session.id, videoUrl.platform, currentInfo.id);
          analysis = currentAnalysis;
          ownsExecution = !cached;
          cacheHit = !!cached;
          send({ ...progress("downloading", 10), analysisId: analysis.id });
          assertAnalysisActive(analysis);
          if (cached) {
            const restored = await timer.measure("cache_restore", () => {
              send(progress("downloading", 100));
              if (!getStoredTranscript(currentAnalysis.id)) {
                saveTranscript(currentAnalysis.id, cached.evidenceSegments, currentInfo,
                  cached.evidenceSegments.map((segment) => segment.embedding), cached.expiresAt);
              }
              return {
                transcript: { text: cached.transcriptText, segments: cached.transcriptSegments, source: cached.transcriptSource, transcription: cached.transcription },
                result: cached.result,
                frames: (currentAnalysis.framesExpireAt ?? 0) > Date.now() ? cached.frames : [],
              };
            });
            transcript = restored.transcript;
            aiResult = restored.result;
            frameInfos = restored.frames;
            visionMetadata = cached.vision ?? { outcome: "unknown", describedFrames: restored.frames?.length ?? 0, totalFrames: restored.frames?.length ?? 0 };
          } else {
            const directories = await timer.measure("workspace", async () => {
              await sweepAnalysisArtifacts();
              return ensureAnalysisDirectories(currentAnalysis.id);
            });
            assertAnalysisActive(analysis);
            scheduleAnalysisCleanup(analysis.id, analysis.expiresAt);
            // 缓存未命中才下载（字幕优先或音频）
            const downloadResult = await timer.measure("download", () => processor.download(url, currentInfo, directories.media, () => assertAnalysisActive(currentAnalysis)));
            assertAnalysisActive(analysis);
            send(progress("downloading", 100));

            // 转写：字幕优先，否则下载音频转写
            transcript = await timer.measure("transcript", async () => {
              let result: TranscriptResult;
              if (downloadResult.subtitlePath && existsSync(downloadResult.subtitlePath)) {
                result = await parseBuiltinSubtitle(downloadResult.subtitlePath);
              } else {
                // 短视频用 tiny 模型提速（仅抖音；YouTube 保持默认模型保证转写质量）
                const isShortVideo = currentInfo.duration < 180;
                const model = processor.useTinyForShortVideos && isShortVideo && process.env.WHISPER_MODEL !== "tiny" ? "tiny" : undefined;
                result = await getTranscriptSmart(downloadResult, send, { model });
              }
              if (result.segments.length === 0) {
                throw new Error("该视频没有检测到语音内容（可能是纯音乐或无声视频），无法生成文字总结");
              }
              return result;
            });
            assertAnalysisActive(analysis);

            // 视觉理解：抽关键帧 → 视觉模型描述（失败静默降级为音频-only）
            const vision = isVisionEnabled() && info.duration
              ? await timer.measure("vision", () => doVisionPhase(url, currentInfo, downloadResult, processor, currentAnalysis, send), (value) => value?.status.outcome === "completed" ? "completed" : "degraded")
              : null;
            assertAnalysisActive(analysis);
            if (vision) {
              frameInfos = vision.frameInfos;
              visionUsage = vision.usage;
              visionStatus = vision.status;
              visionMetadata = { outcome: vision.status.outcome, describedFrames: vision.status.describedFrames, totalFrames: vision.status.totalFrames };
            }

            send(progress("analyzing", mapPhaseProgress("analyzing", 0)));
            const summary = await doAISummarize(info, transcript, analysis, send, timer, vision?.descriptions.length ? vision : undefined, visionMetadata);
            aiResult = summary.result;
            summarizeUsage = summary.usage;
            summarizeLatencyMs = summary.latencyMs;
          }
          assertAnalysisActive(analysis);
          scheduleAnalysisCleanup(analysis.id, analysis.expiresAt);

          // 收尾
          send(progress("done", 100));

          timer.markResultReady();
          const totalMs = timer.elapsedMs();
          const timings = timer.snapshot();
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
              analysisId: analysis.id,
              platform: videoUrl.platform,
              canonicalUrl: videoUrl.platform === "youtube" ? `https://www.youtube.com/watch?v=${info.id}` : `https://www.douyin.com/video/${info.id}`,
              expiresAt: analysis.contentExpiresAt,
              framesExpireAt: analysis.framesExpireAt,
              transcription: transcript.transcription ?? { provider: transcript.source === "builtin" ? "builtin" : "unknown", timing: transcript.source === "builtin" ? "source" : "unknown" },
              vision: visionMetadata,
              video: info,
              transcriptSource: transcript.source,
              transcriptText: transcript.text,
              transcriptSegments: transcript.segments,
              result: aiResult,
              cached: !!cached,
              shared,
              frames: frameInfos ?? [],
              metrics: {
                totalMs,
                summarizeMs: summarizeLatencyMs,
                usage: summarizeUsage,
                cost,
                visionUsage,
                visionCost,
                visionStatus,
                timings,
              },
            },
          });
          outcome = { analysisId: analysis.id, videoId: info.id };
          console.log("[process-timing]", JSON.stringify({ analysisId: analysis.id, platform: videoUrl.platform, cached: cacheHit, shared, outcome: "completed", totalMs, ...timings }));
        } catch (error: unknown) {
          const deleted = analysis?.status === "deleted";
          if (!deleted && !connection.signal.aborted) console.error("[process] 视频处理失败:", error);
          const metrics = { totalMs: timer.elapsedMs(), timings: timer.snapshot() };
          const message = deleted ? "该分析已删除或过期，请重新处理视频" : getUserFacingProcessError(error);
          outcome = { error: message };
          send({ type: "error", message, metrics });
          console.log("[process-timing]", JSON.stringify({ analysisId: analysis?.id, platform: videoUrl.platform, cached: cacheHit, shared, outcome: "failed", ...metrics }));
        } finally {
          clearInterval(heartbeatInterval);
          request.signal.removeEventListener("abort", onAbort);
          connection.signal.removeEventListener("abort", onDisconnect);
          // 等待连接与缓存读取者不拥有产物，断连/超时不能清理正在执行的分析。
          if (analysis && ownsExecution) {
            try {
              if (analysis.status === "completed") {
                await cleanupAnalysisArtifacts(analysis.id, "media");
              } else {
                if (analysis.status !== "deleted") analysis.status = "failed";
                invalidateCache(analysis.id);
                removeTranscript(analysis.id);
                clearConversation(analysis.id);
                await cleanupAnalysisArtifacts(analysis.id);
              }
            } catch { console.error("[process] 独立分析目录清理失败，等待到期扫尾"); }
          }
          if (flight?.leader) flight.finish(outcome);
          try {
            controller.close();
          } catch {
            // 客户端断开时已在 abort 监听中关闭
          }
        }
      },
      cancel() { connection.abort(); },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...(session.cookie ? { "Set-Cookie": session.cookie } : {}),
      },
    });
  } catch (error) {
    if (error instanceof ServiceCapacityError) return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    if (error instanceof RequestValidationError) return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
    return NextResponse.json({ success: false, error: "请求处理失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = guardApiRequest(request, "delete");
  if (denied) return denied;
  try {
    const { videoId, analysisId } = await readJsonObject(request);
    if (!isValidVideoId(videoId) || (analysisId !== undefined && !isAnalysisId(analysisId))) {
      return NextResponse.json({ success: false, error: "请提供合法的 videoId" }, { status: 400 });
    }
    const analysis = getOwnedAnalysis(getSessionId(request), videoId, analysisId);
    if (!analysis) return NextResponse.json({ success: false, error: "分析不存在或已过期" }, { status: 404 });
    // 先撤销写入权，防止在途总结/追问在清理后重新保存内容。
    revokeAnalysis(analysis);
    processFlights.revoke(analysis.id);
    // 同步失效内存态数据，避免缓存命中返回悬空帧引用、追问残留旧数据
    invalidateCache(analysis.id);
    removeTranscript(analysis.id);
    clearConversation(analysis.id);
    await cleanupAnalysisArtifacts(analysis.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: "清理失败，请稍后重试" }, { status: 500 });
  }
}
