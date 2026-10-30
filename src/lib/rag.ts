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
 * 关键词检索（降级方案）：字母数字按词，中日韩文字按连续片段的 2-gram 排序。
 */
export function searchByKeyword(
  segments: SearchSegment[],
  query: string,
  k = 5
): SearchHit[] {
  const terms = new Set<string>();

  const normalizedQuery = query.normalize("NFKC").toLowerCase();
  // 单个数字可能是版本号或章节号；单个英文字母通常是噪声。
  const enWords = normalizedQuery.match(/[a-z0-9]+/g) || [];
  for (const w of enWords) {
    if (w.length >= 2 || /^\d$/.test(w)) terms.add(w);
  }

  // 按连续的中日韩文字切分，不能跨标点或空格拼成不存在的词。
  const cjkRuns = normalizedQuery.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  for (const run of cjkRuns) {
    const chars = Array.from(run);
    for (let i = 0; i + 1 < chars.length; i++) terms.add(chars[i] + chars[i + 1]);
    if (chars.length === 1 && Array.from(normalizedQuery.trim()).length === 1) terms.add(chars[0]);
  }

  if (terms.size === 0) return [];

  const scored = segments
    .map((s) => {
      const lower = s.text.normalize("NFKC").toLowerCase();
      let hits = 0;
      for (const t of terms) {
        const found = /^\d+$/.test(t) ? new RegExp(`(?<![0-9])${t}(?![0-9])`).test(lower) : lower.includes(t);
        if (found) hits++;
      }
      return { segment: s, score: hits / terms.size };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return scored;
}
