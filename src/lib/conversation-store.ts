/**
 * 内存对话历史存储，供追问 API 的多轮上下文使用
 * 格式：{ videoId → [{ question, answer, at }] }
 */
export interface ConversationTurn {
  question: string;
  answer: string;
  at: number;
}

const store = new Map<string, ConversationTurn[]>();

// 每个视频最多保留 10 轮，超过丢最旧的
const MAX_TURNS = 10;

export function saveTurn(videoId: string, question: string, answer: string): void {
  const turns = store.get(videoId) || [];
  turns.push({ question, answer, at: Date.now() });
  if (turns.length > MAX_TURNS) turns.shift();
  store.set(videoId, turns);
}

/** 取最近 limit 轮对话（默认 3） */
export function getConversation(videoId: string, limit = 3): ConversationTurn[] {
  const turns = store.get(videoId) || [];
  return turns.slice(-limit);
}

/** 清空某视频的对话历史（DELETE /api/process 清理时同步） */
export function clearConversation(videoId: string): void {
  store.delete(videoId);
}
