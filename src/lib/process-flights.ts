import { ServiceCapacityError } from "./request-validation";
import type { VideoUrl } from "./url-utils";

export type FlightOutcome = { analysisId: string; videoId: string } | { error: string };
interface FlightProgress { type: "progress"; step: string; percent: number; analysisId?: string }
interface Waiter { progress: (event: FlightProgress) => void; finish: (outcome: FlightOutcome) => void }
interface Flight {
  progress?: FlightProgress;
  outcome?: FlightOutcome;
  waiters: Set<Waiter>;
}

/** 只合并同进程、同会话、同规范链接；不保存字幕、流片段或平台签名 URL。 */
export class ProcessFlights {
  private readonly entries = new Map<string, Flight>();

  constructor(private readonly maxEntries = 128, private readonly maxWaiters = 16, private readonly waitMs = 15 * 60 * 1000) {}

  acquire(ownerId: string, video: VideoUrl) {
    const key = JSON.stringify([ownerId, video.platform, video.url]);
    const existing = this.entries.get(key);
    if (existing) {
      return {
        leader: false as const,
        wait: (progress: Waiter["progress"], signal: AbortSignal) => this.wait(existing, progress, signal),
      };
    }
    if (this.entries.size >= this.maxEntries) throw new ServiceCapacityError("处理中的视频过多，请稍后重试");
    const entry: Flight = { waiters: new Set() };
    this.entries.set(key, entry);
    return {
      leader: true as const,
      publish: (event: unknown) => {
        if (entry.outcome || !event || typeof event !== "object" || !("type" in event) || event.type !== "progress"
            || !("step" in event) || typeof event.step !== "string" || !("percent" in event) || typeof event.percent !== "number") return;
        const analysisId = "analysisId" in event && typeof event.analysisId === "string" ? event.analysisId : entry.progress?.analysisId;
        entry.progress = { type: "progress", step: event.step, percent: event.percent, ...(analysisId ? { analysisId } : {}) };
        for (const waiter of entry.waiters) waiter.progress(entry.progress);
      },
      finish: (outcome: FlightOutcome) => this.finish(key, entry, outcome),
    };
  }

  revoke(analysisId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.progress?.analysisId === analysisId) this.finish(key, entry, { error: "该分析已删除或过期，请重新处理视频" });
    }
  }

  private finish(key: string, entry: Flight, outcome: FlightOutcome): void {
    if (entry.outcome) return;
    entry.outcome = outcome;
    // 删除后可以有新一轮执行，旧执行的 finally 不能删除新条目。
    if (this.entries.get(key) === entry) this.entries.delete(key);
    for (const waiter of [...entry.waiters]) waiter.finish(outcome);
  }

  private wait(entry: Flight, progress: Waiter["progress"], signal: AbortSignal): Promise<FlightOutcome> {
    if (signal.aborted) return Promise.resolve({ error: "连接已断开" });
    if (entry.outcome) return Promise.resolve(entry.outcome);
    if (entry.waiters.size >= this.maxWaiters) throw new ServiceCapacityError("该视频的等待连接过多，请稍后重试");
    return new Promise((resolve) => {
      const waiter: Waiter = { progress, finish: (outcome) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        entry.waiters.delete(waiter);
        resolve(outcome);
      } };
      const onAbort = () => waiter.finish({ error: "连接已断开" });
      const timeout = setTimeout(() => waiter.finish({ error: "等待同视频处理超时，请稍后重试" }), this.waitMs);
      timeout.unref?.();
      signal.addEventListener("abort", onAbort, { once: true });
      entry.waiters.add(waiter);
      if (entry.progress) progress(entry.progress);
    });
  }
}

const runtime = globalThis as typeof globalThis & { vidsnapProcessFlights?: ProcessFlights };
export const processFlights = runtime.vidsnapProcessFlights ??= new ProcessFlights();
