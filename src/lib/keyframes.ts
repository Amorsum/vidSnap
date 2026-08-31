/**
 * 关键帧提取与生命周期管理
 * 均匀采样抽帧（fps=1/N 确定性时间戳，JS 侧计算），帧文件 2h 延迟清理
 */
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

const execFileAsync = promisify(execFile);

export const TEMP_DIR = path.join(os.tmpdir(), "vidsnap");

/** 帧文件保留时长：必须大于 process-cache 的 1h TTL，保证缓存命中时图片仍可访问 */
export const FRAME_TTL_MS = 2 * 60 * 60 * 1000;

export interface Keyframe {
  path: string;
  time: number; // 秒，帧中心时刻（均匀采样确定性计算）
}

// 延迟清理定时器：同一 videoId 重复调度时先清旧 timer（重复处理同视频会重抽帧）
const cleanupTimers = new Map<string, NodeJS.Timeout>();
// 懒清理节流：进程重启后 timer 丢失，靠 mtime 扫描兜底，10 分钟内只扫一次
let lastSweep = 0;

async function listFrameFiles(videoId: string): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.readdir(TEMP_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.startsWith(`${videoId}-kf-`) && f.endsWith(".jpg"))
    .sort();
}

/**
 * 从视频文件均匀采样抽取关键帧（确定性时间戳，不依赖 showinfo 解析）
 * @param cap 帧数上限（时长/cap 为采样间隔）
 */
export async function extractKeyframes(
  videoPath: string,
  videoId: string,
  duration: number,
  cap = 8
): Promise<Keyframe[]> {
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const N = Math.max(1, Math.ceil(duration / cap));
  const outputTemplate = path.join(TEMP_DIR, `${videoId}-kf-%03d.jpg`);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vf", `fps=1/${N},scale='min(480,iw)':-2`,
    "-q:v", "4",
    "-frames:v", String(cap),
    outputTemplate,
  ], { timeout: 120000 });

  const files = await listFrameFiles(videoId);
  if (files.length === 0) {
    throw new Error("关键帧提取失败：未生成任何帧文件");
  }

  // 帧 i 的中心时刻（均匀采样间隔 N 秒）
  return files.map((fileName, i) => ({
    path: path.join(TEMP_DIR, fileName),
    time: (i + 0.5) * N,
  }));
}

/**
 * 调度帧文件延迟清理（重复调度先清旧 timer）
 */
export function scheduleFramesCleanup(videoId: string, ttlMs = FRAME_TTL_MS): void {
  const oldTimer = cleanupTimers.get(videoId);
  if (oldTimer) clearTimeout(oldTimer);
  const timer = setTimeout(() => {
    cleanupTimers.delete(videoId);
    cleanupFrameFiles(videoId);
  }, ttlMs);
  cleanupTimers.set(videoId, timer);
}

/**
 * 立即删除某视频的全部帧文件（DELETE /api/process 主动清理）
 */
export async function cleanupFrameFiles(videoId: string): Promise<void> {
  const files = await listFrameFiles(videoId);
  await Promise.all(files.map((f) => fs.unlink(path.join(TEMP_DIR, f)).catch(() => {})));
}

/**
 * 按 mtime 懒清理过期帧文件（进程重启后 timer 失效的兜底，10 分钟节流）
 * 在抽帧入口与 frames 路由中触发
 */
export async function sweepExpiredFrames(ttlMs = FRAME_TTL_MS): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 10 * 60 * 1000) return;
  lastSweep = now;

  let files: string[];
  try {
    files = await fs.readdir(TEMP_DIR);
  } catch {
    return;
  }

  const expired = files.filter((f) => f.includes("-kf-") && f.endsWith(".jpg"));
  await Promise.all(
    expired.map(async (f) => {
      const fullPath = path.join(TEMP_DIR, f);
      try {
        const stat = await fs.stat(fullPath);
        if (now - stat.mtimeMs > ttlMs) {
          await fs.unlink(fullPath);
        }
      } catch {
        // 文件可能已被并发清理，忽略
      }
    })
  );
}
