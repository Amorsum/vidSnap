import { NextRequest, NextResponse } from "next/server";
import { verifyAccessCode, getClientIp, checkRateLimit } from "@/lib/security";

/** 访问码校验（前端门禁页调用）；仅对失败尝试限流，防止暴力猜测 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body as { code?: string };

    if (verifyAccessCode(code ?? null)) {
      return NextResponse.json({ success: true });
    }

    // 失败才计数：成功校验（页面每次加载都会调用）不受限流影响
    const ip = getClientIp(request);
    const rl = checkRateLimit(`verify-fail:${ip}`, 10, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: `尝试次数过多，请 ${rl.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }
    return NextResponse.json({ success: false, error: "访问码错误" }, { status: 401 });
  } catch {
    return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
  }
}
