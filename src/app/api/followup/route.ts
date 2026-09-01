import { NextRequest, NextResponse } from "next/server";
import { getTranscript, type StoredSegment } from "@/lib/transcript-store";
import { getConversation, saveTurn } from "@/lib/conversation-store";
import { callLLMToolLoop, hasToolSyntax, type ToolDefinition, type ToolCall } from "@/lib/llm";
import { FOLLOWUP_SYSTEM_PROMPT, formatTranscriptForPrompt } from "@/lib/prompts";
import { embedQuery } from "@/lib/embeddings";
import { searchByEmbedding, searchByKeyword } from "@/lib/rag";
import { verifyAccessCode, getClientIp, checkRateLimit } from "@/lib/security";
import { calcCost } from "@/lib/observability";

/**
 * 追问 Agent 工具集：模型自主决定使用哪个检索工具（不再是固定管线）
 * - semantic_search：概念/含义类问题，向量语义检索
 * - keyword_search：专有名词/术语定位，关键词检索
 * - segment_range：明确时间位置问题，按时间范围取字幕
 */
function buildTools(segments: StoredSegment[]): ToolDefinition[] {
  return [
    {
      name: "semantic_search",
      description:
        "按语义相似度检索视频字幕片段，返回带 [MM:SS] 时间戳的相关片段。适合概念、含义类问题（如「视频里讲的方法是什么」）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索用的自然语言问题或短语" },
        },
        required: ["query"],
      },
    },
    {
      name: "keyword_search",
      description:
        "按关键词定位视频字幕片段，返回带 [MM:SS] 时间戳的命中片段。适合专有名词、术语、数字等精确匹配（如「提到了什么型号」）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "关键词或短语" },
        },
        required: ["query"],
      },
    },
    {
      name: "segment_range",
      description:
        "获取指定时间范围内的字幕原文。适合用户明确提到时间位置的问题（如「第 2 分钟讲了什么」「开头/结尾」）。",
      parameters: {
        type: "object",
        properties: {
          start: { type: "number", description: "起始秒数" },
          end: { type: "number", description: "结束秒数" },
        },
        required: ["start", "end"],
      },
    },
  ];
}

/** 工具执行器：捕获 segments 闭包，错误文本回喂模型（模型可换工具或直接回答） */
function executeTool(toolCall: ToolCall, segments: StoredSegment[]): Promise<string> {
  let args: { query?: string; start?: number; end?: number };
  try {
    args = JSON.parse(toolCall.arguments || "{}");
  } catch {
    return Promise.resolve("参数解析失败，请换一种检索方式或直接回答");
  }

  switch (toolCall.name) {
    case "semantic_search": {
      const query = String(args.query || "").trim();
      if (!query) return Promise.resolve("缺少 query 参数");
      const hasEmbeddings = segments.some((s) => s.embedding && s.embedding.length > 0);
      if (!hasEmbeddings) {
        return Promise.resolve("向量检索不可用（字幕未向量化），请改用 keyword_search 或直接回答");
      }
      return embedQuery(query)
        .then((vec) => {
          const hits = searchByEmbedding(segments, vec);
          if (hits.length === 0) return "语义检索无命中，可尝试 keyword_search 或直接回答";
          return formatTranscriptForPrompt(hits.map((h) => h.segment));
        })
        .catch(
          (err) =>
            `向量检索失败: ${err instanceof Error ? err.message : String(err)}，可尝试 keyword_search 或直接回答`
        );
    }
    case "keyword_search": {
      const query = String(args.query || "").trim();
      if (!query) return Promise.resolve("缺少 query 参数");
      const hits = searchByKeyword(segments, query);
      if (hits.length === 0) return Promise.resolve("关键词检索无命中，可尝试 semantic_search 或直接回答");
      return Promise.resolve(formatTranscriptForPrompt(hits.map((h) => h.segment)));
    }
    case "segment_range": {
      const start = Number(args.start);
      const end = Number(args.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return Promise.resolve("start/end 必须是合法的秒数区间");
      }
      const overlapping = segments
        .filter((s) => s.start < end && s.end > start)
        .slice(0, 20);
      if (overlapping.length === 0) return Promise.resolve("该时间段内没有字幕内容");
      return Promise.resolve(formatTranscriptForPrompt(overlapping));
    }
    default:
      return Promise.reject(new Error(`未知工具: ${toolCall.name}`));
  }
}

/** toolsUsed → retrievalSource 映射（保留旧字段兼容前端） */
function mapSource(toolsUsed: string[]): "rag" | "keyword" | "range" | "full" {
  if (toolsUsed.includes("semantic_search")) return "rag";
  if (toolsUsed.includes("keyword_search")) return "keyword";
  if (toolsUsed.includes("segment_range")) return "range";
  return "full";
}

export async function POST(request: NextRequest) {
  try {
    // 访问码门禁
    if (!verifyAccessCode(request.headers.get("x-access-code"))) {
      return NextResponse.json(
        { success: false, error: "需要访问码，请向站长获取" },
        { status: 401 }
      );
    }

    // 每 IP 限流：10 分钟最多 30 次追问
    const ip = getClientIp(request);
    const rl = checkRateLimit(`followup:${ip}`, 30, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: `请求过于频繁，请 ${rl.retryAfterSec} 秒后再试` },
        { status: 429 }
      );
    }

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

    // 多轮上下文：取最近 3 轮对话，让模型理解指代
    const history = getConversation(videoId, 3);
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    for (const t of history) {
      messages.push({ role: "user", content: t.question });
      messages.push({ role: "assistant", content: t.answer });
    }
    messages.push({
      role: "user",
      content: `视频标题：${stored.videoInfo.title}\n\n用户当前问题：${question}`,
    });

    // Agent 化：模型自主决定是否检索、用哪个工具、检索几次
    const result = await callLLMToolLoop({
      systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
      messages,
      tools: buildTools(stored.segments),
      executeTool: (call) => executeTool(call, stored.segments),
      maxToolRounds: 3,
      maxTokens: 1500,
    });

    if (!result.text) {
      return NextResponse.json(
        { success: false, error: "追问生成失败，请稍后重试" },
        { status: 500 }
      );
    }
    // 双保险：模型输出的伪工具调用格式若未被清洗干净，兜底替换为友好提示
    if (hasToolSyntax(result.text)) {
      result.text = "抱歉，这个问题我没能很好地组织回答，请换个问法试试。";
    }

    if (result.usage) {
      console.log(
        `[metrics] ${videoId} 追问完成: token ${result.usage.totalTokens} (in ${result.usage.promptTokens}/out ${result.usage.completionTokens}), 工具调用 ${result.toolsUsed.length} 次 [${result.toolsUsed.join(", ") || "无"}], 成本 ¥${calcCost(result.usage).toFixed(4)}`
      );
    }

    saveTurn(videoId, question, result.text);

    return NextResponse.json({
      success: true,
      answer: result.text,
      videoId,
      retrievalSource: mapSource(result.toolsUsed),
      toolsUsed: result.toolsUsed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "追问失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
