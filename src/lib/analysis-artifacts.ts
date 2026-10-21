import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ARTIFACT_TTL_MS, isAnalysisId } from "./analysis-store";

const ROOT = path.join(os.tmpdir(), "vidsnap", "analyses");
const timers = new Map<string, NodeJS.Timeout>();

export function scheduleAnalysisCleanup(analysisId: string, expiresAt: number, kind?: "frames"): void {
  analysisDirectory(analysisId);
  const key = `${analysisId}:${kind ?? "all"}`;
  const previous = timers.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    timers.delete(key);
    cleanupAnalysisArtifacts(analysisId, kind).catch(() => console.error("[artifacts] 到期目录清理失败，等待懒清理重试"));
  }, Math.max(0, expiresAt - Date.now()));
  timer.unref();
  timers.set(key, timer);
}

export function analysisDirectory(analysisId: string, kind?: "media" | "frames"): string {
  if (!isAnalysisId(analysisId)) throw new Error("非法的 analysisId");
  return kind ? path.join(ROOT, analysisId, kind) : path.join(ROOT, analysisId);
}

async function rejectSymlink(directory: string): Promise<void> {
  try {
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("拒绝访问符号链接产物目录");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

/** 目录 ID 只来自服务端 UUID，逐层拒绝链接，避免清理跟随路径逃逸。 */
export async function validateAnalysisDirectory(analysisId: string, kind?: "media" | "frames"): Promise<string> {
  await rejectSymlink(path.dirname(ROOT));
  await rejectSymlink(ROOT);
  await rejectSymlink(analysisDirectory(analysisId));
  const target = analysisDirectory(analysisId, kind);
  if (kind) await rejectSymlink(target);
  return target;
}

export async function ensureAnalysisDirectories(analysisId: string): Promise<{ media: string; frames: string }> {
  const media = await validateAnalysisDirectory(analysisId, "media");
  const frames = await validateAnalysisDirectory(analysisId, "frames");
  await fs.mkdir(media, { recursive: true });
  await fs.mkdir(frames, { recursive: true });
  return { media, frames };
}

export async function cleanupAnalysisArtifacts(analysisId: string, kind?: "media" | "frames"): Promise<void> {
  const target = await validateAnalysisDirectory(analysisId, kind);
  await fs.rm(target, { recursive: true, force: true });
  if (!kind) {
    for (const key of [`${analysisId}:all`, `${analysisId}:frames`]) {
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
    }
  }
}

/** 崩溃遗留的目录在最后一次写入 2 小时后扫尾；只扫描本模块 UUID 命名空间。 */
export async function sweepAnalysisArtifacts(): Promise<void> {
  await rejectSymlink(path.dirname(ROOT));
  await rejectSymlink(ROOT);
  let entries;
  try { entries = await fs.readdir(ROOT, { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isAnalysisId(entry.name)) continue;
    const directory = await validateAnalysisDirectory(entry.name);
    const dates = await Promise.all([directory, path.join(directory, "media"), path.join(directory, "frames")].map(async (item) => {
      try { return (await fs.lstat(item)).mtimeMs; } catch { return 0; }
    }));
    if (Date.now() - Math.max(...dates) >= ARTIFACT_TTL_MS) await cleanupAnalysisArtifacts(entry.name);
  }
}
