/**
 * 鉴权与限流（内存实现，适用于单实例部署）
 * - 访问码：ACCESS_CODE 环境变量，未配置时不启用门禁
 * - 限流：每 IP 滑动窗口计数，窗口过期数据惰性清理
 */

const ACCESS_CODE = process.env.ACCESS_CODE;

/** 提取客户端真实 IP：经 Cloudflare 隧道时远端地址是 127.0.0.1，需读转发头 */
export function getClientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

/** 校验访问码：未配置 ACCESS_CODE 时不启用门禁（向后兼容） */
export function verifyAccessCode(code: string | null): boolean {
  if (!ACCESS_CODE) return true;
  return code === ACCESS_CODE;
}

// ─── 每 IP 滑动窗口限流 ───

const hits = new Map<string, number[]>();

/** 简单清理：条目过多时移除已全部过期的桶（时间戳均早于窗口起点），防止内存无限增长 */
function sweepIfNeeded(now: number, windowMs: number): void {
  if (hits.size < 1000) return;
  for (const [key, timestamps] of hits) {
    if (timestamps.every((t) => t <= now - windowMs)) hits.delete(key);
  }
}

/**
 * 滑动窗口限流：窗口内最多 maxRequests 次
 * 返回是否放行；被拒绝时返回建议重试秒数
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const history = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (history.length >= maxRequests) {
    hits.set(key, history);
    return {
      allowed: false,
      retryAfterSec: Math.ceil((history[0] + windowMs - now) / 1000),
    };
  }

  history.push(now);
  hits.set(key, history);
  sweepIfNeeded(now, windowMs);
  return { allowed: true, retryAfterSec: 0 };
}
