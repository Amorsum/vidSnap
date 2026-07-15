import { NextRequest, NextResponse } from "next/server";
import { getTranscript } from "@/lib/transcript-store";
import { callLLMWithPrompt } from "@/lib/llm";
import { FOLLOWUP_SYSTEM_PROMPT, formatTranscriptForPrompt } from "@/lib/prompts";

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

    const transcriptText = formatTranscriptForPrompt(stored.segments);

    const userMessage = `视频标题：${stored.videoInfo.title}

视频字幕（带时间戳）：

${transcriptText}

用户问题：${question}`;

    const answer = await callLLMWithPrompt(FOLLOWUP_SYSTEM_PROMPT, userMessage, {
      maxTokens: 1000,
    });

    return NextResponse.json({ success: true, answer, videoId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "追问失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}