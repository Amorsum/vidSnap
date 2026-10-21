import { NextRequest, NextResponse } from "next/server";
import { verifyAccessCode, getClientIp, checkRateLimit, checkMutationOrigin } from "@/lib/security";
import { readJsonObject, RequestValidationError, ServiceCapacityError } from "@/lib/request-validation";
import { ensureSession } from "@/lib/session";

/** 访问码校验（前端门禁页调用）；仅对失败尝试限流，防止暴力猜测 */
export async function POST(request: NextRequest) {
  const denied = checkMutationOrigin(request);
  if (denied) return denied;
  try {
    const { code } = await readJsonObject(request);
    if (code !== undefined && (typeof code !== "string" || code.length > 4096)) {
      return NextResponse.json({ success: false, error: "访问码格式错误" }, { status: 400 });
    }

    if (verifyAccessCode(code ?? null)) {
      const session = ensureSession(request);
      return NextResponse.json({ success: true }, { headers: session.cookie ? { "Set-Cookie": session.cookie } : {} });
    }

    // 失败才计数：成功校验（页面每次加载都会调用）不受限流影响
    const ip = getClientIp(request);
    const rl = checkRateLimit(`verify-fail:${ip}`, 10, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: `尝试次数过多，请 ${rl.retryAfterSec} 秒后再试` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }
    return NextResponse.json({ success: false, error: "访问码错误" }, { status: 401 });
  } catch (error) {
    if (error instanceof ServiceCapacityError) return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    if (error instanceof RequestValidationError) return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
    return NextResponse.json({ success: false, error: "校验服务暂时不可用" }, { status: 500 });
  }
}
