import { sseLines } from "./sse";
import { isAnalysisResult } from "./learning";
import type { AnalysisResult } from "./learning-types";

export interface ProcessProgress { step: string; percent?: number; analysisId?: string }

export class ProcessStreamInterruptedError extends Error {
  constructor() { super("连接中断，尚未取得完整结果，请恢复连接或重试"); this.name = "ProcessStreamInterruptedError"; }
}

/** 完成依赖 result，不把 stream_end、done 或静默 EOF 当作成功。 */
export async function readProcessResult(response: Response, onProgress: (event: ProcessProgress) => void, onGenerating: () => void): Promise<AnalysisResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取响应流，请重试");
  try {
    for await (const line of sseLines(reader)) {
      if (!line.startsWith("data: ")) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (!event || typeof event !== "object") continue;
      if (event.type === "error") throw new Error(typeof event.message === "string" ? event.message : "处理失败，请重试");
      if (event.type === "result") {
        if (!isAnalysisResult(event.data)) throw new Error("总结内容不完整，请重试");
        return event.data;
      }
      if (event.type === "progress" && typeof event.step === "string") onProgress(event);
      if (event.type === "stream_start" || event.type === "stream") onGenerating();
    }
    throw new ProcessStreamInterruptedError();
  } catch (error) {
    if (error instanceof TypeError) throw new ProcessStreamInterruptedError();
    throw error;
  } finally { await reader.cancel().catch(() => {}); }
}

export function retryDeadline(header: string | null, now = Date.now()): number {
  if (!header) return now + 60_000;
  if (/^\d+$/.test(header)) return now + Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(now, date) : now + 60_000;
}
