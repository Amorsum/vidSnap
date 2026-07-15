import { NextRequest, NextResponse } from "next/server";
import { extractTextFromVideo, cleanupTempFiles } from "@/lib/video-processor";
import { transcribeAudio } from "@/lib/whisper";
import { callLLM, SummarizeMode } from "@/lib/llm";

export async function POST(request: NextRequest) {
  try {
    const { url, mode = "summary" } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "请提供视频链接" }, { status: 400 });
    }

    const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeRegex.test(url)) {
      return NextResponse.json({ error: "目前仅支持 YouTube 链接" }, { status: 400 });
    }

    const validModes: SummarizeMode[] = ["summary", "keypoints", "translate"];
    if (!validModes.includes(mode)) {
      return NextResponse.json({ error: "无效的模式，可选：summary, keypoints, translate" }, { status: 400 });
    }

    // Step 1: 下载 + 转录
    const result = await extractTextFromVideo(url, (audioPath) =>
      transcribeAudio(audioPath)
    );

    // Step 2: AI 总结
    const { result: summary, provider } = await callLLM(result.text, mode);

    // Step 3: 清理临时文件
    await cleanupTempFiles(result.info.id);

    return NextResponse.json({
      success: true,
      video: {
        id: result.info.id,
        title: result.info.title,
        duration: result.info.duration,
        thumbnail: result.info.thumbnail,
        uploader: result.info.uploader,
      },
      transcription: {
        text: result.text,
        segments: result.segments,
        language: result.language,
        source: result.source,
      },
      summary,
      provider,
      mode,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "处理失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}