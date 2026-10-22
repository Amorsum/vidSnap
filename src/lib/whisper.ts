import { getWhisperClient } from "./whisper-client";

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
}

/**
 * 使用 Whisper 将音频转录为文本
 */
export async function transcribeAudio(
  audioPath: string,
  modelName: string = process.env.WHISPER_MODEL || "medium"
): Promise<TranscriptionResult> {
  const result = await getWhisperClient().transcribe({ audio_path: audioPath, model: modelName });
  return { ...result, language: result.language ?? "unknown" };
}
