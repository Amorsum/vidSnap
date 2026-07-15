/**
 * 处理结果缓存 —— 企业级项目的核心加速手段
 * 已处理过的视频直接返回缓存结果，跳过下载+转写+AI总结
 * 
 * 缓存策略：
 * - 内存 Map，读写 < 1ms
 * - 自动清理超过 1 小时的记录
 * - 超过 50 条时触发清理
 */
import type { TranscriptSegment } from "./transcriber";

interface CachedProcessResult {
  video: {
    id: string;
    title: string;
    duration: number;
    thumbnail: string;
    uploader: string;
  };
  transcriptSource: "builtin" | "whisper";
  transcriptText: string;
  transcriptSegments: TranscriptSegment[];
  result: Record<string, unknown>;
  savedAt: number;
}

const cache = new Map<string, CachedProcessResult>();
const MAX_AGE_MS = 60 * 60 * 1000; // 1 小时

function cleanup() {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (now - value.savedAt > MAX_AGE_MS) {
      cache.delete(key);
    }
  }
}

export function cacheResult(videoId: string, result: Omit<CachedProcessResult, "savedAt">): void {
  cache.set(videoId, { ...result, savedAt: Date.now() });
  if (cache.size > 50) cleanup();
}

export function getCachedResult(videoId: string): CachedProcessResult | null {
  const record = cache.get(videoId);
  if (!record) return null;
  if (Date.now() - record.savedAt > MAX_AGE_MS) {
    cache.delete(videoId);
    return null;
  }
  return record;
}