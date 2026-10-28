import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { validateAnalysisDirectory } from "@/lib/analysis-artifacts";
import { verifyFrameToken } from "@/lib/vision";
import { getClientIp, checkRateLimit } from "@/lib/security";
import { getSessionId } from "@/lib/session";
import { getOwnedAnalysis, isAnalysisId } from "@/lib/analysis-store";

/**
 * 关键帧图片服务：GET /api/frames?videoId=..&idx=..&token=..
 * 同时校验匿名会话归属与 HMAC 签名，图片请求自动携带同源 Cookie。
 */
export async function GET(request: NextRequest) {
  // 每 IP 限流：图片请求量大，额度放宽到 120 次/10 分钟
  const ip = getClientIp(request);
  const rl = checkRateLimit(`frames:${ip}`, 120, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后再试` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const { searchParams } = request.nextUrl;
  const videoId = searchParams.get("videoId") ?? "";
  const idxRaw = searchParams.get("idx") ?? "";
  const token = searchParams.get("token") ?? "";
  const analysisId = searchParams.get("analysisId") ?? undefined;

  // videoId 白名单校验（防路径穿越）
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(videoId) || (analysisId !== undefined && !isAnalysisId(analysisId))) {
    return NextResponse.json({ success: false, error: "非法的 videoId" }, { status: 400 });
  }
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 1 || idx > 99) {
    return NextResponse.json({ success: false, error: "非法的 idx" }, { status: 400 });
  }

  // 帧图必须属于当前会话且具备有效签名。
  const analysis = getOwnedAnalysis(getSessionId(request), videoId, analysisId);
  if (!analysis || !analysis.framesExpireAt || analysis.framesExpireAt <= Date.now()) {
    return NextResponse.json({ success: false, error: "关键帧不存在或已过期" }, { status: 404 });
  }
  const tokenValid = token ? await verifyFrameToken(token, analysis.id, idx) : false;
  if (!tokenValid) {
    return NextResponse.json({ success: false, error: "关键帧签名无效或已过期" }, { status: 401 });
  }

  const fileName = `${videoId}-kf-${String(idx).padStart(3, "0")}.jpg`;
  if (path.basename(fileName) !== fileName) {
    return NextResponse.json({ success: false, error: "非法的文件名" }, { status: 400 });
  }

  try {
    const directory = await validateAnalysisDirectory(analysis.id, "frames");
    const filePath = path.join(directory, fileName);
    if ((await fs.lstat(filePath)).isSymbolicLink()) throw new Error("拒绝访问符号链接帧图");
    const buffer = await fs.readFile(filePath);
    if (getOwnedAnalysis(getSessionId(request), videoId, analysis.id) !== analysis || analysis.framesExpireAt <= Date.now()) {
      return NextResponse.json({ success: false, error: "关键帧不存在或已过期" }, { status: 404 });
    }
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        // 与帧文件 TTL 一致；private 避免共享缓存泄漏
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "关键帧不存在或已过期" }, { status: 404 });
  }
}
