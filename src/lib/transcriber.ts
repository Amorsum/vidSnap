import { execFile, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

// ─── Whisper 常驻服务器客户端 ───

interface WhisperQueueItem {
  request: unknown;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  onProgress?: (percent: number) => void;
}

let whisperServer: ChildProcess | null = null;
let whisperBusy = false;
const whisperQueue: WhisperQueueItem[] = [];

function getWhisperServer(): ChildProcess {
  if (!whisperServer || whisperServer.exitCode !== null) {
    const scriptPath = path.join(SCRIPTS_DIR, "whisper_server.py");
    const defaultModel = process.env.WHISPER_MODEL || "small";
    whisperServer = spawn("python", [scriptPath, defaultModel], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    whisperServer.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[whisper] ${msg}`);
    });
    whisperServer.on("exit", (code) => {
      console.log(`[whisper] 服务器退出，code=${code}`);
      whisperServer = null;
    });
  }
  return whisperServer;
}

function sendWhisperRequest(
  request: unknown,
  onProgress?: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    whisperQueue.push({ request, resolve, reject, onProgress });
    processQueue();
  });
}

function processQueue() {
  if (whisperBusy || whisperQueue.length === 0) return;

  const server = getWhisperServer();
  if (!server.stdin || !server.stdout) {
    const err = new Error("Whisper 服务器未就绪");
    whisperQueue.forEach((q) => q.reject(err));
    whisperQueue.length = 0;
    return;
  }

  whisperBusy = true;
  const { request, resolve, reject, onProgress } = whisperQueue.shift()!;

  server.stdin.write(JSON.stringify(request) + "\n");

  // 读取多行响应，直到收到 "result" 或 "error"
  let buffer = "";
  const onData = (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 保留不完整的最后一行

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "progress") {
          onProgress?.(parsed.percent);
        } else if (parsed.type === "result") {
          server.stdout!.removeListener("data", onData);
          resolve(JSON.stringify(parsed));
          whisperBusy = false;
          processQueue();
          return;
        } else if (parsed.type === "error") {
          server.stdout!.removeListener("data", onData);
          reject(new Error(parsed.error || "Whisper 转写失败"));
          whisperBusy = false;
          processQueue();
          return;
        }
      } catch {
        // 跳过无法解析的行
      }
    }
  };
  server.stdout.on("data", onData);
}

// ─── 类型定义 ───

export interface TranscriptSegment {
  start: number; // 秒
  end: number; // 秒
  text: string;
}

export interface TranscriptResult {
  text: string; // 完整文本
  segments: TranscriptSegment[]; // 带时间戳的分段
  source: "builtin" | "whisper"; // 字幕来源
  language?: string;
}

// ─── Whisper 本地转写 ───

/**
 * 使用常驻 Whisper 服务器转写音频（模型只加载一次，消除每次 2-5s 冷启动）
 * 如果服务器不可用，降级到单次脚本模式
 */
export async function transcribeAudio(
  audioPath: string,
  options?: {
    model?: string;
    language?: string;
    outputDir?: string;
    onProgress?: (percent: number) => void;
  }
): Promise<TranscriptResult> {
  const model = options?.model || process.env.WHISPER_MODEL || "medium";
  const language = options?.language || undefined;
  const onProgress = options?.onProgress;

  // 优先使用常驻服务器
  try {
    const rawJson = await sendWhisperRequest(
      {
        audio_path: audioPath,
        model,
        language,
      },
      onProgress
    );
    const result = JSON.parse(rawJson);

    if (result.error) {
      throw new Error(result.error);
    }

    return {
      text: result.text,
      segments: result.segments.map((seg: { start: number; end: number; text: string }) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
      })),
      source: "whisper",
      language: result.language,
    };
  } catch {
    // 服务器不可用，降级到单次脚本模式
    console.log("[whisper] 常驻服务器不可用，降级到单次脚本模式");
    const scriptPath = path.join(SCRIPTS_DIR, "whisper_asr.py");
    const args: string[] = [scriptPath, audioPath, model];
    if (language) args.push(language);

    const { stdout } = await execFileAsync("python", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });

    const result = JSON.parse(stdout);
    if (result.error) throw new Error(result.error);

    return {
      text: result.text,
      segments: result.segments.map((seg: { start: number; end: number; text: string }) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
      })),
      source: "whisper",
      language: result.language,
    };
  }
}

// ─── 统一获取字幕入口 ───

import type { ProcessResult } from "./video-processor";

/**
 * 获取视频字幕（使用 Whisper 转写）
 */
export async function getTranscript(
  processResult: ProcessResult,
  options?: {
    language?: string;
    outputDir?: string;
    model?: string;
    onProgress?: (percent: number) => void;
  }
): Promise<TranscriptResult> {
  // 直接使用 Whisper / SenseVoice 转写
  return transcribeAudio(processResult.audioPath, {
    model: options?.model || process.env.WHISPER_MODEL,
    language: options?.language,
    outputDir: options?.outputDir,
    onProgress: options?.onProgress,
  });
}
