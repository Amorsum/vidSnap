import { NextRequest, NextResponse } from "next/server";
import { extractTextFromVideo, cleanupTempFiles } from "@/lib/video-processor";
import { transcribeAudio } from "@/lib/whisper";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "请提供视频链接" }, { status: 400 });
    }

    const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!youtubeRegex.test(url)) {
      return NextResponse.json({ error: "目前仅支持 YouTube 链接" }, { status: 400 });
    }

    const result = await extractTextFromVideo(url, (audioPath) =>
      transcribeAudio(audioPath)
    );

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
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "转录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}