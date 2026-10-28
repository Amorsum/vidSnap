import { sseLines } from "../src/lib/sse";
import { isAnalysisId } from "../src/lib/analysis-store";
import { hasToolSyntax } from "../src/lib/llm";
import { SAMPLE_ID, SAMPLE_URL } from "./media-smoke";
import type { PipelineTimings, PipelineStage, StageOutcome } from "../src/lib/pipeline-timing";

const STAGES: PipelineStage[] = ["metadata", "cache_lookup", "cache_restore", "inflight_wait", "workspace", "download", "transcript", "vision", "summary", "embedding", "persist"];
const OUTCOMES: StageOutcome[] = ["completed", "degraded", "failed"];
type Check = { id: string; status: "pass" | "fail"; details: Record<string, unknown> };
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function duration(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

export function localAcceptanceUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || Number(url.port) < 1024
      || ["3000", "3001"].includes(url.port) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("isolated_loopback_url_required");
  }
  return url.origin;
}

/** 只选择已知计时字段，禁止把服务端任意字段或内容正文带入诊断报告。 */
export function timingSummary(metrics: unknown): PipelineTimings & { totalMs: number } {
  if (!record(metrics) || !duration(metrics.totalMs) || !record(metrics.timings) || !record(metrics.timings.stages)) throw new Error("timing_contract_missing");
  const input = metrics.timings;
  const stageInput = metrics.timings.stages;
  const stages: PipelineTimings["stages"] = {};
  for (const stage of STAGES) {
    const value = stageInput[stage];
    if (value === undefined) continue;
    if (!record(value) || !duration(value.ms)) throw new Error("invalid_stage_timing");
    const outcome = OUTCOMES.find((outcome) => outcome === value.outcome);
    if (!outcome) throw new Error("invalid_stage_outcome");
    stages[stage] = { ms: value.ms, outcome };
  }
  const points: Pick<PipelineTimings, "firstTokenMs" | "summaryReadyMs" | "resultReadyMs"> = { firstTokenMs: null, summaryReadyMs: null, resultReadyMs: null };
  for (const point of ["firstTokenMs", "summaryReadyMs", "resultReadyMs"] as const) {
    const value = input[point];
    if (value !== null && !duration(value)) throw new Error("invalid_timing_point");
    points[point] = value;
  }
  return { totalMs: metrics.totalMs, stages, ...points };
}

export async function checkPipeline(base: string, fetcher: typeof fetch = fetch) {
  base = localAcceptanceUrl(base);
  const checks: Check[] = [];
  let cookie = "";
  let analysisId: string | undefined;
  let activeStage = "isolation";
  let verified = false;
  let failureTimings: ReturnType<typeof timingSummary> | undefined;
  const request = async (route: string, body: unknown, method = "POST", timeout = 10000) => {
    const response = await fetcher(`${base}${route}`, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout), redirect: "error",
    });
    if (response.headers.get("x-vidsnap-live-acceptance") !== "text-only" || response.headers.has("x-vidsnap-test-mocks")) throw new Error("isolation_marker_missing");
    return response;
  };
  const process = async () => {
    const response = await request("/api/process", { url: SAMPLE_URL }, "POST", 180000);
    if (!response.ok || !response.body) throw new Error("process_http_failed");
    let result: Record<string, unknown> | undefined;
    let streamParts = 0;
    let errored = false;
    for await (const line of sseLines(response.body.getReader())) {
      if (!line.startsWith("data: ")) continue;
      const event: unknown = JSON.parse(line.slice(6));
      if (!record(event)) continue;
      if (isAnalysisId(event.analysisId)) analysisId = event.analysisId;
      if (event.type === "stream") streamParts++;
      if (event.type === "error") {
        errored = true;
        try { failureTimings = timingSummary(event.metrics); } catch { /* 兼容未提供计时的失败响应。 */ }
      }
      if (event.type === "result" && record(event.data)) result = event.data;
    }
    if (errored || !result || !isAnalysisId(result.analysisId)) throw new Error("process_result_missing");
    analysisId = result.analysisId;
    if (!record(result.video) || result.video.id !== SAMPLE_ID || !duration(result.video.duration) || result.video.duration <= 0 || result.video.duration > 30
        || !Array.isArray(result.transcriptSegments) || result.transcriptSegments.length === 0 || !record(result.result)
        || typeof result.result.overall !== "string" || !result.result.overall.trim()) throw new Error("process_result_invalid");
    return { result, streamParts, timings: timingSummary(result.metrics) };
  };
  try {
    const preflight = await fetcher(base, { signal: AbortSignal.timeout(10000), redirect: "error" });
    await preflight.body?.cancel();
    if (!preflight.ok || preflight.headers.get("x-vidsnap-live-acceptance") !== "text-only" || preflight.headers.has("x-vidsnap-test-mocks")) throw new Error("isolated_live_server_required");
    checks.push({ id: activeStage, status: "pass", details: { text_only: true, mock_upstream: false } });
    activeStage = "session";
    const verification = await request("/api/session", {});
    if (!verification.ok) throw new Error("verification_failed");
    cookie = verification.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie) throw new Error("session_cookie_missing");
    await verification.body?.cancel();
    checks.push({ id: activeStage, status: "pass", details: {} });
    activeStage = "process";
    const first = await process();
    if (first.result.cached !== false || first.streamParts === 0) throw new Error("cold_request_required");
    checks.push({ id: activeStage, status: "pass", details: { cached: false, transcript_source: first.result.transcriptSource === "builtin" ? "builtin" : "asr", stream_parts: first.streamParts, timings: first.timings } });
    activeStage = "followup";
    const followup = await request("/api/followup", { videoId: SAMPLE_ID, analysisId, question: "视频提到了什么动物？请依据视频内容回答。" }, "POST", 90000);
    const answer: unknown = await followup.json();
    if (!followup.ok || !record(answer) || answer.success !== true || typeof answer.answer !== "string" || !answer.answer.trim() || hasToolSyntax(answer.answer)
        || !Array.isArray(answer.toolsUsed) || !answer.toolsUsed.every((tool) => ["semantic_search", "keyword_search", "segment_range"].includes(tool))
        || !["rag", "keyword", "range", "full"].includes(String(answer.retrievalSource))) throw new Error("followup_failed");
    checks.push({ id: activeStage, status: "pass", details: { nonempty_answer: true, tools_used: answer.toolsUsed, retrieval_source: answer.retrievalSource } });
    activeStage = "cache";
    const cached = await process();
    if (cached.result.cached !== true || cached.result.analysisId !== first.result.analysisId || cached.streamParts !== 0
        || JSON.stringify(cached.result.result) !== JSON.stringify(first.result.result)
        || cached.timings.firstTokenMs !== null || cached.timings.summaryReadyMs !== null) throw new Error("cache_reuse_failed");
    checks.push({ id: activeStage, status: "pass", details: { same_analysis: true, stream_parts: 0, timings: cached.timings } });
    activeStage = "delete";
    const deleted = await request("/api/process", { videoId: SAMPLE_ID, analysisId }, "DELETE");
    await deleted.body?.cancel();
    if (!deleted.ok) throw new Error("delete_failed");
    checks.push({ id: activeStage, status: "pass", details: {} });
    activeStage = "after_delete";
    const expired = await request("/api/followup", { videoId: SAMPLE_ID, analysisId, question: "删除后不应调用模型" });
    await expired.body?.cancel();
    if (expired.status !== 404) throw new Error("deleted_evidence_still_accessible");
    checks.push({ id: activeStage, status: "pass", details: { status: 404 } });
    analysisId = undefined;
    verified = true;
  } catch {
    checks.push({ id: activeStage, status: "fail", details: { reason: "stage_not_verified", ...(failureTimings ? { timings: failureTimings } : {}) } });
  } finally {
    if (analysisId) {
      try {
        const cleanup = await request("/api/process", { videoId: SAMPLE_ID, analysisId }, "DELETE");
        await cleanup.body?.cancel();
        checks.push({ id: "failure_cleanup", status: cleanup.ok ? "pass" : "fail", details: {} });
      } catch { checks.push({ id: "failure_cleanup", status: "fail", details: {} }); }
    }
  }
  return { schema_version: 1, scope: "live_text_api_pipeline", sample_id: SAMPLE_ID, text_api_pipeline_verified: verified, full_pipeline_verified: false, checks };
}
