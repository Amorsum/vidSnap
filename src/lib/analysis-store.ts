import { randomUUID } from "node:crypto";
import type { Platform } from "./url-utils";
import { ServiceCapacityError } from "./request-validation";

export const CONTENT_TTL_MS = 60 * 60 * 1000;
export const ARTIFACT_TTL_MS = 2 * CONTENT_TTL_MS;

export interface Analysis {
  id: string;
  ownerId: string;
  platform: Platform;
  videoId: string;
  status: "running" | "completed" | "deleted" | "failed";
  expiresAt: number;
  contentExpiresAt?: number;
  framesExpireAt?: number;
}

const runtime = globalThis as typeof globalThis & { vidsnapAnalyses?: Map<string, Analysis> };
const analyses = runtime.vidsnapAnalyses ??= new Map<string, Analysis>();

export function isAnalysisId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

export function createAnalysis(ownerId: string, platform: Platform, videoId: string): Analysis {
  for (const [id, analysis] of analyses) if (analysis.expiresAt <= Date.now()) analyses.delete(id);
  if (analyses.size >= 1000) throw new ServiceCapacityError("分析容量已满，请稍后重试");
  const analysis: Analysis = { id: randomUUID(), ownerId, platform, videoId, status: "running", expiresAt: Date.now() + ARTIFACT_TTL_MS };
  analyses.set(analysis.id, analysis);
  return analysis;
}

export function getOwnedAnalysis(ownerId: string | null, videoId: string, analysisId?: string): Analysis | null {
  const candidates = analysisId ? [analyses.get(analysisId)] : [...analyses.values()];
  const matches = candidates.filter((analysis): analysis is Analysis => !!analysis && analysis.ownerId === ownerId
    && analysis.videoId === videoId && analysis.status !== "deleted" && analysis.status !== "failed" && analysis.expiresAt > Date.now());
  // 旧客户端只传 videoId 时仅允许唯一匹配，避免跨平台 ID 碰撞或错指旧分析。
  return matches.length === 1 ? matches[0] : null;
}

export function findReusableAnalysis(ownerId: string, platform: Platform, videoId: string): Analysis | null {
  return [...analyses.values()].find((analysis) => analysis.ownerId === ownerId && analysis.platform === platform
    && analysis.videoId === videoId && analysis.status === "completed" && (analysis.contentExpiresAt ?? 0) > Date.now()) ?? null;
}

export function assertAnalysisActive(analysis: Analysis): void {
  if (analyses.get(analysis.id) !== analysis || !["running", "completed"].includes(analysis.status) || analysis.expiresAt <= Date.now()) {
    throw new Error("该分析已删除或过期，请重新处理视频");
  }
}

export function completeAnalysis(analysis: Analysis): number {
  assertAnalysisActive(analysis);
  if (analysis.status !== "running") throw new Error("分析结果不能重复提交");
  analysis.status = "completed";
  analysis.contentExpiresAt = Date.now() + CONTENT_TTL_MS;
  analysis.expiresAt = Math.max(analysis.contentExpiresAt, analysis.framesExpireAt ?? 0);
  return analysis.contentExpiresAt;
}

export function revokeAnalysis(analysis: Analysis): void {
  analysis.status = "deleted";
}

/** 只读状态查询不按 videoId 猜测归属，不返回其他会话的存在信息。 */
export function getOwnedAnalysisById(ownerId: string | null, analysisId: string): Analysis | null {
  const analysis = analyses.get(analysisId);
  return analysis && analysis.ownerId === ownerId && analysis.expiresAt > Date.now()
    && analysis.status !== "deleted" && analysis.status !== "failed" ? analysis : null;
}
