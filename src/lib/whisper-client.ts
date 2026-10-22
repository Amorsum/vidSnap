import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { randomUUID } from "crypto";
import { StringDecoder } from "string_decoder";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface WhisperRequest { audio_path: string; model: string; language?: string }
export interface WhisperTranscript {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language?: string;
}
type FailureCode = "capacity" | "queue_timeout" | "timeout" | "startup" | "process" | "protocol" | "transcription" | "closed";
export class WhisperFailure extends Error {
  constructor(public readonly code: FailureCode, message: string) { super(message); this.name = "WhisperFailure"; }
}

/** 使用固定文案并兼容路由 bundle 间共享实例，不输出 Python/命令原文。 */
export function whisperFailureMessage(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "WhisperFailure" || !("code" in error)) return null;
  if (error.code === "capacity") return "本地转写队列已满，请稍后重试";
  if (error.code === "queue_timeout") return "本地转写排队超时，请稍后重试";
  if (error.code === "timeout" || error.code === "startup") return "本地转写超时，请稍后重试";
  return "本地转写服务暂不可用，请稍后重试";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWhisperTranscript(value: unknown): WhisperTranscript {
  if (!record(value) || typeof value.text !== "string" || !Array.isArray(value.segments)
    || (value.language !== undefined && typeof value.language !== "string")) {
    throw new WhisperFailure("protocol", "Whisper 返回格式不正确");
  }
  const segments = value.segments.map((segment: unknown) => {
    if (!record(segment) || typeof segment.text !== "string" || typeof segment.start !== "number"
      || typeof segment.end !== "number" || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < 0 || segment.end < segment.start) {
      throw new WhisperFailure("protocol", "Whisper 返回片段不正确");
    }
    return { start: segment.start, end: segment.end, text: segment.text };
  });
  return { text: value.text, segments, language: value.language };
}

interface Job {
  id: string;
  request: WhisperRequest;
  deadline: number;
  resolve: (value: WhisperTranscript) => void;
  reject: (error: Error) => void;
  onProgress?: (percent: number) => void;
  queueTimer: NodeJS.Timeout;
}
interface Worker {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  failed?: WhisperFailure;
  closed: boolean;
  closePromise: Promise<void>;
  active?: { job: Job; resolve: (value: WhisperTranscript) => void; reject: (error: Error) => void };
}
interface ClientOptions {
  timeoutMs?: number;
  startupTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxQueue?: number;
  defaultModel?: string;
  spawnWorker?: (model: string) => ChildProcessWithoutNullStreams;
  fallback?: (request: WhisperRequest, remainingMs: number) => Promise<WhisperTranscript>;
}

function envTimeout(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1000 && value <= 30 * 60 * 1000 ? value : fallback;
}

/** 常驻转写与单次脚本共用一个执行槽；故障不会触发并行加载多个模型。 */
export class WhisperClient {
  private worker?: Worker;
  private readonly queue: Job[] = [];
  private busy = false;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly queueTimeoutMs: number;
  private readonly maxQueue: number;

  constructor(private readonly options: ClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? envTimeout("WHISPER_TIMEOUT_MS", 10 * 60 * 1000);
    this.startupTimeoutMs = options.startupTimeoutMs ?? envTimeout("WHISPER_STARTUP_TIMEOUT_MS", 2 * 60 * 1000);
    this.queueTimeoutMs = options.queueTimeoutMs ?? 2 * 60 * 1000;
    this.maxQueue = options.maxQueue ?? 8;
  }

  transcribe(request: WhisperRequest, onProgress?: (percent: number) => void): Promise<WhisperTranscript> {
    if (this.closed) return Promise.reject(new WhisperFailure("closed", "Whisper 客户端已关闭"));
    if (this.queue.length >= this.maxQueue) return Promise.reject(new WhisperFailure("capacity", "Whisper 等待队列已满，请稍后重试"));
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: randomUUID(), request, deadline: Date.now() + this.timeoutMs, resolve, reject, onProgress,
        queueTimer: setTimeout(() => {
          const index = this.queue.indexOf(job);
          if (index < 0) return;
          this.queue.splice(index, 1);
          reject(new WhisperFailure("queue_timeout", "Whisper 排队超时，请稍后重试"));
        }, Math.min(this.queueTimeoutMs, this.timeoutMs)),
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private remaining(job: Job): number {
    const remaining = job.deadline - Date.now();
    if (remaining <= 0) throw new WhisperFailure("timeout", "Whisper 转写超时，请稍后重试");
    return remaining;
  }

  private pump(): void {
    if (this.busy || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    clearTimeout(job.queueTimer);
    this.busy = true;
    this.execute(job).then(job.resolve, job.reject).finally(() => {
      this.busy = false;
      this.pump();
    });
  }

  private fail(worker: Worker, error: WhisperFailure): void {
    worker.failed ??= error;
    worker.rejectReady(error);
    const active = worker.active;
    worker.active = undefined;
    active?.reject(error);
  }

  private createWorker(): Worker {
    const model = this.options.defaultModel || process.env.WHISPER_MODEL || "medium";
    const child = this.options.spawnWorker?.(model) ?? spawn("python", [path.join(process.cwd(), "scripts", "whisper_server.py"), model], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    let resolveClosed!: () => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // 握手前进程也可能立即失败，处理器统一安装，避免未观察的 rejection。
    void ready.catch(() => {});
    const worker: Worker = {
      child, ready, resolveReady, rejectReady, closed: false,
      closePromise: new Promise<void>((resolve) => { resolveClosed = resolve; }),
    };
    this.worker = worker;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.worker !== worker || worker.failed) return;
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) {
        this.fail(worker, new WhisperFailure("protocol", "Whisper 响应超出大小限制"));
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { this.message(worker, JSON.parse(line)); }
        catch { this.fail(worker, new WhisperFailure("protocol", "Whisper 通信协议异常")); }
      }
    });
    // 持续消费日志，避免 stderr 管道填满阻塞；不回显路径、字幕或模型异常原文。
    child.stderr.resume();
    child.stderr.on("error", () => this.fail(worker, new WhisperFailure("process", "Whisper 日志管道读取失败")));
    child.on("error", () => this.fail(worker, new WhisperFailure("process", "Whisper 进程无法启动")));
    child.on("exit", () => this.fail(worker, new WhisperFailure("process", "Whisper 进程意外退出")));
    child.on("close", () => {
      worker.closed = true;
      resolveClosed();
      this.fail(worker, new WhisperFailure("process", "Whisper 进程已关闭"));
    });
    child.stdin.on("error", () => this.fail(worker, new WhisperFailure("process", "Whisper 请求写入失败")));
    child.stdout.on("error", () => this.fail(worker, new WhisperFailure("process", "Whisper 响应读取失败")));
    child.stdout.on("end", () => this.fail(worker, new WhisperFailure("process", "Whisper 响应流已关闭")));
    return worker;
  }

  private message(worker: Worker, value: unknown): void {
    if (!record(value)) throw new Error("invalid message");
    if (value.type === "ready") {
      if (value.protocol !== 1) throw new Error("unsupported protocol");
      worker.resolveReady();
      return;
    }
    const active = worker.active;
    if (!active || value.request_id !== active.job.id) return;
    if (value.type === "progress") {
      if (typeof value.percent === "number" && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100) {
        try { active.job.onProgress?.(value.percent); } catch { /* 调用方进度显示异常不影响转写收尾。 */ }
      }
    } else if (value.type === "result") {
      const result = parseWhisperTranscript(value);
      worker.active = undefined;
      active.resolve(result);
    } else if (value.type === "error") {
      worker.active = undefined;
      active.reject(new WhisperFailure("transcription", "Whisper 转写失败，请检查音频或稍后重试"));
    }
  }

  private async persistent(job: Job): Promise<WhisperTranscript> {
    if (this.worker?.failed) await this.stopWorker(this.worker);
    let worker;
    try { worker = this.worker ?? this.createWorker(); }
    catch { throw new WhisperFailure("process", "Whisper 进程无法启动"); }
    const startupTimer = setTimeout(() => this.fail(worker, new WhisperFailure("startup", "Whisper 启动超时")),
      Math.min(this.startupTimeoutMs, this.remaining(job)));
    try { await worker.ready; }
    finally { clearTimeout(startupTimer); }
    if (worker.failed) throw worker.failed;
    const timeout = this.remaining(job);
    return new Promise<WhisperTranscript>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(worker, new WhisperFailure("timeout", "Whisper 转写超时，请稍后重试")), timeout);
      worker.active = {
        job, resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      try {
        worker.child.stdin.write(JSON.stringify({ ...job.request, request_id: job.id }) + "\n", (error) => {
          if (error) this.fail(worker, new WhisperFailure("process", "Whisper 请求写入失败"));
        });
      } catch { this.fail(worker, new WhisperFailure("process", "Whisper 请求写入失败")); }
    });
  }

  private async stopWorker(worker: Worker): Promise<void> {
    if (!worker.closed) {
      worker.child.kill("SIGKILL");
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([worker.closePromise, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new WhisperFailure("closed", "Whisper 进程未确认退出，请稍后重试")), 1000);
        })]);
      } finally { clearTimeout(timer); }
    }
    if (this.worker === worker) this.worker = undefined;
  }

  private async execute(job: Job): Promise<WhisperTranscript> {
    try {
      this.remaining(job);
      return await this.persistent(job);
    } catch (error) {
      const failure = error instanceof WhisperFailure ? error : new WhisperFailure("process", "Whisper 服务不可用");
      if (this.worker) await this.stopWorker(this.worker);
      if (this.closed || ["timeout", "queue_timeout", "capacity", "closed"].includes(failure.code)) throw failure;
      // 同一个总预算内只兜底一次；持有 busy 槽直到脚本退出，后续请求继续排队。
      const remaining = this.remaining(job);
      if (this.options.fallback) {
        const result = await this.options.fallback(job.request, remaining);
        this.remaining(job);
        if (this.closed) throw new WhisperFailure("closed", "Whisper 客户端已关闭");
        return parseWhisperTranscript(result);
      }
      const args = [path.join(process.cwd(), "scripts", "whisper_asr.py"), job.request.audio_path, job.request.model];
      if (job.request.language) args.push(job.request.language);
      try {
        const { stdout } = await execFileAsync("python", args, {
          timeout: remaining, killSignal: "SIGKILL", maxBuffer: MAX_RESPONSE_BYTES, windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
        });
        this.remaining(job);
        if (this.closed) throw new WhisperFailure("closed", "Whisper 客户端已关闭");
        return parseWhisperTranscript(JSON.parse(stdout));
      } catch {
        if (this.closed) throw new WhisperFailure("closed", "Whisper 客户端已关闭");
        this.remaining(job);
        throw new WhisperFailure("transcription", "Whisper 脚本转写失败，请稍后重试");
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.queueTimer);
      job.reject(new WhisperFailure("closed", "Whisper 客户端已关闭"));
    }
    if (this.worker) {
      this.fail(this.worker, new WhisperFailure("closed", "Whisper 客户端已关闭"));
      await this.stopWorker(this.worker);
    }
  }
}

const runtime = globalThis as typeof globalThis & { vidsnapWhisperClient?: WhisperClient };
export function getWhisperClient(): WhisperClient {
  return runtime.vidsnapWhisperClient ??= new WhisperClient();
}
