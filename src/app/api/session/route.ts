import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/security";
import { readJsonObject, RequestValidationError, ServiceCapacityError } from "@/lib/request-validation";
import { ensureSession } from "@/lib/session";

/** 为需要预先建立匿名会话的客户端签发 HttpOnly Cookie。 */
export async function POST(request: NextRequest) {
  const denied = guardApiRequest(request, "session");
  if (denied) return denied;
  try {
    await readJsonObject(request);
    const session = ensureSession(request);
    return NextResponse.json({ success: true }, { headers: session.cookie ? { "Set-Cookie": session.cookie } : {} });
  } catch (error) {
    if (error instanceof ServiceCapacityError) return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    if (error instanceof RequestValidationError) return NextResponse.json({ success: false, error: "请求格式错误" }, { status: 400 });
    return NextResponse.json({ success: false, error: "会话服务暂时不可用" }, { status: 500 });
  }
}
