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
import type { VideoInfo } from "./video-processor";
import type { FrameInfo } from "./vision";

interface CachedProcessResult {
  video: VideoInfo;
  transcriptSource: "builtin" | "whisper";
  transcriptText: string;
  transcriptSegments: TranscriptSegment[];
  transcriptEmbeddings?: number[][];
  result: Record<string, unknown>;
  /** 关键帧元数据（仅文本，不缓存图片二进制；帧文件 TTL 2h > 缓存 TTL 1h，命中时图片仍可访问） */
  frames?: FrameInfo[];
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

/** 主动失效（DELETE /api/process 清理时同步清缓存，避免返回悬空帧引用） */
export function invalidateCache(videoId: string): void {
  cache.delete(videoId);
}