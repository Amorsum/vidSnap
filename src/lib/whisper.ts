import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

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
  modelName: string = "small"
): Promise<TranscriptionResult> {
  const scriptPath = path.join(SCRIPTS_DIR, "whisper_asr.py");

  const { stdout } = await execFileAsync("python", [
    scriptPath,
    audioPath,
    modelName,
  ]);

  const result = JSON.parse(stdout);

  if (result.error) {
    throw new Error(result.error);
  }

  return result as TranscriptionResult;
}