/**
 * 内存对话历史存储，供追问 API 的多轮上下文使用
 * 按 analysisId 存储，随所属字幕到期，不因追问延长保存时间。
 */
export interface ConversationTurn {
  question: string;
  answer: string;
  at: number;
}

type Conversation = { turns: ConversationTurn[]; expiresAt: number };
const runtime = globalThis as typeof globalThis & { vidsnapConversations?: Map<string, Conversation> };
const store = runtime.vidsnapConversations ??= new Map<string, Conversation>();

// 每个视频最多保留 10 轮，超过丢最旧的
const MAX_TURNS = 10;

export function saveTurn(analysisId: string, question: string, answer: string, expiresAt: number): void {
  if (expiresAt <= Date.now()) return;
  for (const [key, record] of store) if (record.expiresAt <= Date.now()) store.delete(key);
  const turns = getConversation(analysisId, MAX_TURNS);
  turns.push({ question, answer, at: Date.now() });
  if (turns.length > MAX_TURNS) turns.shift();
  store.set(analysisId, { turns, expiresAt });
}

/** 取最近 limit 轮对话（默认 3） */
export function getConversation(analysisId: string, limit = 3): ConversationTurn[] {
  if (limit <= 0) return [];
  const record = store.get(analysisId);
  if (!record) return [];
  if (record.expiresAt <= Date.now()) {
    store.delete(analysisId);
    return [];
  }
  return record.turns.slice(-Math.max(0, limit));
}

/** 清空某视频的对话历史（DELETE /api/process 清理时同步） */
export function clearConversation(analysisId: string): void {
  store.delete(analysisId);
}
