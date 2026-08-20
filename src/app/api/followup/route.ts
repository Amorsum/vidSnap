import { NextRequest, NextResponse } from "next/server";
import { getTranscript } from "@/lib/transcript-store";
import { callLLMWithPrompt } from "@/lib/llm";
import { FOLLOWUP_SYSTEM_PROMPT, formatTranscriptForPrompt } from "@/lib/prompts";
import { embedQuery } from "@/lib/embeddings";
import { searchByEmbedding, searchByKeyword } from "@/lib/rag";

type RetrievalSource = "rag" | "keyword" | "full";

/**
 * 从存储的字幕中检索与问题最相关的片段
 * 三级降级：向量检索 → 关键词检索 → 全文兜底
 */
async function retrieveContext(
  segments: { start: number; end: number; text: string; embedding?: number[] }[],
  question: string
): Promise<{ context: string; source: RetrievalSource }> {
  // 1. 向量检索（segment 携带 embedding 时）
  const hasEmbeddings = segments.some((s) => s.embedding && s.embedding.length > 0);
  if (hasEmbeddings) {
    try {
      const queryVec = await embedQuery(question);
      const hits = searchByEmbedding(segments, queryVec);
      if (hits.length > 0) {
        return {
          context: formatTranscriptForPrompt(hits.map((h) => h.segment)),
          source: "rag",
        };
      }
    } catch (err) {
      console.log("[rag] 向量检索失败，降级到关键词检索:", err);
    }
  }

  // 2. 关键词检索
  const kwHits = searchByKeyword(segments, question);
  if (kwHits.length > 0) {
    return {
      context: formatTranscriptForPrompt(kwHits.map((h) => h.segment)),
      source: "keyword",
    };
  }

  // 3. 全文兜底
  return {
    context: formatTranscriptForPrompt(segments),
    source: "full",
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoId, question } = body as { videoId?: string; question?: string };

    if (!videoId || !question) {
      return NextResponse.json(
        { success: false, error: "请提供 videoId 和问题" },
        { status: 400 }
      );
    }

    const stored = getTranscript(videoId);
    if (!stored) {
      return NextResponse.json(
        { success: false, error: "视频数据已过期，请重新处理视频" },
        { status: 404 }
      );
    }

    const { context, source } = await retrieveContext(stored.segments, question);

    const userMessage = `视频标题：${stored.videoInfo.title}

以下是与你的问题相关的视频字幕片段（带时间戳）：

${context}

用户问题：${question}`;

    const answer = await callLLMWithPrompt(FOLLOWUP_SYSTEM_PROMPT, userMessage, {
      maxTokens: 1000,
    });

    return NextResponse.json({ success: true, answer, videoId, retrievalSource: source });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "追问失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
