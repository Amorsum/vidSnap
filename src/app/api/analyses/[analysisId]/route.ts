import { NextRequest, NextResponse } from "next/server";
import { getOwnedAnalysisById, isAnalysisId } from "@/lib/analysis-store";
import { getTranscript } from "@/lib/transcript-store";
import { guardApiRequest } from "@/lib/security";
import { getSessionId } from "@/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ analysisId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const denied = guardApiRequest(request, "analysis");
  if (denied) {
    denied.headers.set("Cache-Control", headers["Cache-Control"]);
    return denied;
  }
  const { analysisId } = await params;
  const analysis = isAnalysisId(analysisId) ? getOwnedAnalysisById(getSessionId(request), analysisId) : null;
  if (!analysis) return NextResponse.json({ success: false, error: "分析不可用，请重新分析后继续追问" }, { status: 404, headers });
  return NextResponse.json({
    success: true,
    analysisId,
    status: analysis.status,
    expiresAt: analysis.contentExpiresAt ?? null,
    framesExpireAt: analysis.framesExpireAt ?? null,
    canFollowUp: analysis.status === "completed" && (analysis.contentExpiresAt ?? 0) > Date.now() && !!getTranscript(analysisId),
  }, { headers });
}
