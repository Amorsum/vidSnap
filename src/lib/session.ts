import { randomBytes } from "node:crypto";
import { ServiceCapacityError } from "./request-validation";

export const SESSION_COOKIE = "vidsnap-session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// 同一 Node 进程的路由 bundle/HMR 共用身份表；多进程持久会话留待 M3。
const runtime = globalThis as typeof globalThis & { vidsnapSessions?: Map<string, number> };
const sessions = runtime.vidsnapSessions ??= new Map<string, number>();

export function getSessionId(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  const expiresAt = sessions.get(value);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(value);
    return null;
  }
  return value;
}

/** 客户端给出的陌生 ID 不注册为会话；只接受服务端已签发的随机凭据。 */
export function ensureSession(request: Request): { id: string; cookie?: string } {
  const existing = getSessionId(request);
  if (existing) return { id: existing };
  for (const [id, expiresAt] of sessions) if (expiresAt <= Date.now()) sessions.delete(id);
  if (sessions.size >= 10000) throw new ServiceCapacityError("会话容量已满，请稍后重试");
  const id = randomBytes(32).toString("hex");
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  return {
    id,
    cookie: `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`,
  };
}
