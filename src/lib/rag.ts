/**
 * RAG 检索：余弦相似度 top-k 检索 + 关键词降级
 */

export interface SearchSegment {
  start: number;
  end: number;
  text: string;
  embedding?: number[];
}

export interface SearchHit {
  segment: SearchSegment;
  score: number; // 余弦相似度 0-1，或关键词命中率
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 向量余弦相似度检索 top-k 相关片段
 */
export function searchByEmbedding(
  segments: SearchSegment[],
  queryEmbedding: number[],
  k = 5,
  minScore = 0.2
): SearchHit[] {
  return segments
    .filter((s) => s.embedding && s.embedding.length > 0)
    .map((s) => ({ segment: s, score: cosineSimilarity(queryEmbedding, s.embedding!) }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * 关键词检索（降级方案）：英文按单词、中文按 2-gram，统计命中率排序
 */
export function searchByKeyword(
  segments: SearchSegment[],
  query: string,
  k = 5
): SearchHit[] {
  const terms = new Set<string>();

  // 英文单词（≥2 字符）
  const enWords = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const w of enWords) {
    if (w.length >= 2) terms.add(w);
  }

  // 中文 2-gram
  const cjk = query.replace(/[^一-龥]/g, "");
  for (let i = 0; i + 1 < cjk.length; i++) {
    terms.add(cjk.slice(i, i + 2));
  }

  if (terms.size === 0) return [];

  const scored = segments
    .map((s) => {
      const lower = s.text.toLowerCase();
      let hits = 0;
      for (const t of terms) {
        if (lower.includes(t)) hits++;
      }
      return { segment: s, score: hits / terms.size };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored;
}
