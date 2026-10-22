export type PipelineStage = "metadata" | "cache_lookup" | "cache_restore" | "workspace" | "download" | "transcript" | "vision" | "summary" | "embedding" | "persist";
export type StageOutcome = "completed" | "degraded" | "failed";
export interface StageTiming { ms: number; outcome: StageOutcome }
export interface PipelineTimings {
  stages: Partial<Record<PipelineStage, StageTiming>>;
  /** 从本次流水线开始计时；首片段可能只是 JSON，不代表界面已有可读总结。 */
  firstTokenMs: number | null;
  summaryReadyMs: number | null;
  resultReadyMs: number | null;
}

/** 单请求、单调时钟计时；缓存命中不复制旧请求的耗时，未运行阶段保持缺省。 */
export class PipelineTimer {
  private readonly start: number;
  private readonly stages: PipelineTimings["stages"] = {};
  private firstToken: number | null = null;
  private summaryReady: number | null = null;
  private resultReady: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.start = now();
  }

  elapsedMs(): number { return Math.max(0, Math.round(this.now() - this.start)); }

  async measure<T>(stage: PipelineStage, work: () => T | Promise<T>, outcome: (value: T) => StageOutcome = () => "completed"): Promise<T> {
    const start = this.now();
    try {
      const value = await work();
      this.stages[stage] = { ms: (this.stages[stage]?.ms ?? 0) + Math.max(0, Math.round(this.now() - start)), outcome: outcome(value) };
      return value;
    } catch (error) {
      this.stages[stage] = { ms: (this.stages[stage]?.ms ?? 0) + Math.max(0, Math.round(this.now() - start)), outcome: "failed" };
      throw error;
    }
  }

  markFirstToken(): void { this.firstToken ??= this.elapsedMs(); }
  markSummaryReady(): void { this.summaryReady ??= this.elapsedMs(); }
  markResultReady(): void { this.resultReady ??= this.elapsedMs(); }

  snapshot(): PipelineTimings {
    return {
      stages: Object.fromEntries(Object.entries(this.stages).map(([stage, timing]) => [stage, { ...timing }])),
      firstTokenMs: this.firstToken, summaryReadyMs: this.summaryReady, resultReadyMs: this.resultReady,
    };
  }
}
