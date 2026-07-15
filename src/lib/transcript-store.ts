/**
 * 内存 transcript 存储，供追问 API 使用
 * 格式：{ videoId → { segments, videoInfo, timestamp } }
 */
interface StoredTranscript {
  segments: { start: number; end: number; text: string }[];
  videoInfo: { id: string; title: string; duration: number; thumbnail: string; uploader: string };
  savedAt: number;
}

const store = new Map<string, StoredTranscript>();

// 自动清理超过 1 小时的记录
const MAX_AGE_MS = 60 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now - value.savedAt > MAX_AGE_MS) {
      store.delete(key);
    }
  }
}

export function saveTranscript(
  videoId: string,
  segments: { start: number; end: number; text: string }[],
  videoInfo: { id: string; title: string; duration: number; thumbnail: string; uploader: string }
): void {
  store.set(videoId, { segments, videoInfo, savedAt: Date.now() });
  // 每次保存时顺带清理过期记录
  if (store.size > 50) cleanup();
}

export function getTranscript(videoId: string): StoredTranscript | null {
  const record = store.get(videoId);
  if (!record) return null;
  if (Date.now() - record.savedAt > MAX_AGE_MS) {
    store.delete(videoId);
    return null;
  }
  return record;
}