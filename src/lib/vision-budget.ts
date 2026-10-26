export class VisionBudgetExceeded extends Error {
  constructor() { super("视觉处理预算已耗尽"); }
}

export function visionTimeoutMs(): number {
  const value = process.env.VISION_TIMEOUT_MS ?? "30000";
  const timeout = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(timeout) && timeout >= 1000 && timeout <= 120000 ? timeout : 30000;
}

/** 下载、抽帧、模型链共用单调截止时间；文件写入进程须自行限时并等待收尾。 */
export class VisionBudget {
  private readonly deadline: number;

  constructor(readonly timeoutMs = visionTimeoutMs(), private readonly now = () => performance.now(), private readonly assertActive = () => {}) {
    this.deadline = now() + timeoutMs;
  }

  get exhausted(): boolean { this.assertActive(); return this.now() >= this.deadline; }

  remainingMs(minimum = 1): number {
    this.assertActive();
    const remaining = Math.floor(this.deadline - this.now());
    if (remaining < minimum) throw new VisionBudgetExceeded();
    return remaining;
  }

  /** 仅用于可取消的读取/HTTP；晚到的响应不再参与结果或启动下一轮请求。 */
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new VisionBudgetExceeded()), this.remainingMs());
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const pending = Promise.resolve().then(() => {
        this.remainingMs();
        return work(controller.signal);
      });
      const value = await Promise.race([pending, aborted]);
      this.remainingMs();
      return value;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }
}
