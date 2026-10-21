/**
 * 内存 transcript 存储，供追问 API 使用
 * 以服务端 analysisId 隔离；路由必须先校验会话归属。
 * 每个 segment 可携带 embedding，供 RAG 追问检索使用
 */
import type { VideoInfo } from "./video-processor";
import { CONTENT_TTL_MS } from "./analysis-store";

export interface StoredSegment {
  start: number;
  end: number;
  text: string;
  embedding?: number[];
}

interface StoredTranscript {
  segments: StoredSegment[];
  videoInfo: VideoInfo;
  expiresAt: number;
}

const runtime = globalThis as typeof globalThis & { vidsnapTranscripts?: Map<string, StoredTranscript> };
const store = runtime.vidsnapTranscripts ??= new Map<string, StoredTranscript>();

// 自动清理超过 1 小时的记录

function cleanup() {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now >= value.expiresAt) {
      store.delete(key);
    }
  }
}

export function saveTranscript(
  analysisId: string,
  segments: { start: number; end: number; text: string }[],
  videoInfo: VideoInfo,
  embeddings?: (number[] | undefined)[],
  expiresAt = Date.now() + CONTENT_TTL_MS,
): void {
  const storedSegments: StoredSegment[] = segments.map((seg, i) => ({
    ...seg,
    embedding: embeddings?.[i],
  }));
  store.set(analysisId, { segments: storedSegments, videoInfo, expiresAt });
  // 每次保存时顺带清理过期记录
  if (store.size > 50) cleanup();
}

export function getTranscript(analysisId: string): StoredTranscript | null {
  const record = store.get(analysisId);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) {
    store.delete(analysisId);
    return null;
  }
  return record;
}

/** 主动移除（DELETE /api/process 清理时同步失效，避免追问残留旧数据） */
export function removeTranscript(analysisId: string): void {
  store.delete(analysisId);
}
