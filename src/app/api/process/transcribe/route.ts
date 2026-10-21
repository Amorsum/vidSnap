import { NextRequest, NextResponse } from "next/server";
import { extractTextFromVideo } from "@/lib/video-processor";
import { transcribeAudio } from "@/lib/whisper";
import { parseVideoUrl } from "@/lib/url-utils";
import { guardApiRequest } from "@/lib/security";
import { readJsonObject, RequestValidationError } from "@/lib/request-validation";

export async function POST(request: NextRequest) {
  const denied = guardApiRequest(request, "process");
  if (denied) return denied;
  try {
    const { url } = await readJsonObject(request);

    if (!url) {
      return NextResponse.json({ error: "请提供视频链接" }, { status: 400 });
    }

    const videoUrl = parseVideoUrl(url);
    if (videoUrl?.platform !== "youtube") {
      return NextResponse.json({ error: "目前仅支持 YouTube 链接" }, { status: 400 });
    }

    const result = await extractTextFromVideo(videoUrl.url, (audioPath) =>
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
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "转录失败，请检查链接或稍后重试" }, { status: 500 });
  }
}
