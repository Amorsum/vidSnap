/**
 * 硅基流动 embedding 封装（OpenAI 兼容格式）
 * 端点: POST https://api.siliconflow.cn/v1/embeddings
 * 模型: BAAI/bge-m3（多语言，适配中英日韩混排字幕）
 * 复用 SENSEVOICE_API_KEY（与 SenseVoice 转写同一账号）
 */
import type { TranscriptSegment } from "./transcriber";

const API_BASE = "https://api.siliconflow.cn/v1/embeddings";
const DEFAULT_MODEL = "BAAI/bge-m3";
// 单个文本最大字符数（bge-m3 上限 8192 token，留足余量）
const MAX_TEXT_CHARS = 4000;
// 单次请求最大文本条数（分批，避免单次过大）
const BATCH_SIZE = 32;

interface EmbeddingResponse {
  data: { index: number; embedding: number[] }[];
}

/**
 * 单批调用 embedding API
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.SENSEVOICE_API_KEY;
  if (!apiKey) {
    throw new Error("SENSEVOICE_API_KEY 未配置，无法生成 embedding");
  }

  const model = process.env.EMBEDDING_MODEL || DEFAULT_MODEL;

  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "未知错误");
    throw new Error(`Embedding API 错误 (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as EmbeddingResponse;
  if (!data.data || data.data.length === 0) {
    throw new Error("Embedding API 返回空结果");
  }

  // 按 index 排序，保证与输入顺序一致
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * 批量生成文本向量，返回与输入一一对应的向量数组。
 * 内部做清洗（去空/截断超长）与分批，避免单条异常导致整批失败。
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const cleaned = texts.map((t) => {
    const s = t.trim().slice(0, MAX_TEXT_CHARS);
    return s || " "; // 空文本用空格占位，保持索引对齐
  });

  const results: number[][] = [];
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE);
    results.push(...(await embedBatch(batch)));
  }
  return results;
}

/**
 * 为字幕分段批量生成 embedding。
 * 失败时返回 undefined（不抛异常），让调用方降级到关键词检索。
 */
export async function tryEmbedSegments(
  segments: TranscriptSegment[]
): Promise<number[][] | undefined> {
  try {
    return await embed(segments.map((s) => s.text));
  } catch (err) {
    console.log("[embedding] 生成失败，追问将降级到关键词检索:", err);
    return undefined;
  }
}

/**
 * 生成单条查询的 embedding（追问时用）
 */
export async function embedQuery(query: string): Promise<number[]> {
  const [vec] = await embed([query]);
  return vec;
}
