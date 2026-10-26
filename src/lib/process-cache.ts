/**
 * 按 analysisId 隔离的处理结果缓存，路由读取前校验会话归属。
 * 已处理过的视频直接返回缓存结果，跳过下载+转写+AI总结
 * 
 * 缓存策略：
 * - 内存 Map，读写 < 1ms
 * - 自动清理超过 1 小时的记录
 * - 超过 50 条时触发清理
 */
import type { TranscriptionMetadata, VisionMetadata } from "./learning-types";
import type { TranscriptSegment } from "./transcriber";
import type { VideoInfo } from "./video-processor";
import type { FrameInfo } from "./vision";
import type { StoredSegment } from "./transcript-store";

interface CachedProcessResult {
  video: VideoInfo;
  transcriptSource: "builtin" | "whisper";
  transcription?: TranscriptionMetadata;
  vision?: VisionMetadata;
  transcriptText: string;
  transcriptSegments: TranscriptSegment[];
  transcriptEmbeddings?: number[][];
  /** 字幕与画面共用一份完整证据版本，缓存恢复不延长内容期限。 */
  evidenceSegments: StoredSegment[];
  result: Record<string, unknown>;
  /** 关键帧元数据（仅文本，不缓存图片二进制；帧文件 TTL 2h > 缓存 TTL 1h，命中时图片仍可访问） */
  frames?: FrameInfo[];
  expiresAt: number;
}

const runtime = globalThis as typeof globalThis & { vidsnapResultCache?: Map<string, CachedProcessResult> };
const cache = runtime.vidsnapResultCache ??= new Map<string, CachedProcessResult>();

function cleanup() {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (now >= value.expiresAt) {
      cache.delete(key);
    }
  }
}

export function cacheResult(analysisId: string, result: CachedProcessResult): void {
  cache.set(analysisId, result);
  if (cache.size > 50) cleanup();
}

export function getCachedResult(analysisId: string): CachedProcessResult | null {
  const record = cache.get(analysisId);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) {
    cache.delete(analysisId);
    return null;
  }
  return record;
}

/** 主动失效（DELETE /api/process 清理时同步清缓存，避免返回悬空帧引用） */
export function invalidateCache(analysisId: string): void {
  cache.delete(analysisId);
}
