"use client";

import { useState } from "react";

/** 关键帧元数据（与服务端 result 载荷的 frames 字段一致） */
export interface FrameInfo {
  time: number;
  src: string;
  description: string;
}

interface KeyframeGalleryProps {
  frames?: FrameInfo[];
  /** 点击帧卡片时跳转到对应时间（滚动定位分段） */
  onJumpToTime?: (t: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 关键帧画廊：横向滚动缩略图 + 时间戳 + 画面描述，点击跳转到对应时间轴分段 */
export default function KeyframeGallery({ frames, onJumpToTime }: KeyframeGalleryProps) {
  // 图片加载失败（帧已过期/被清理）时隐藏该卡片，画廊优雅降级
  const [hiddenIdx, setHiddenIdx] = useState<Set<number>>(new Set());

  if (!frames || frames.length === 0) return null;

  const visible = frames.filter((_, i) => !hiddenIdx.has(i));
  if (visible.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium text-[#86909c]">🎞️ 关键帧</span>
        <span className="rounded-full bg-[#e8f3ff] px-2 py-0.5 text-[10px] text-[#165dff]">
          {visible.length} 帧
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {frames.map((f, i) => {
          if (hiddenIdx.has(i)) return null;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToTime?.(f.time)}
              title={`跳转到 ${formatTime(f.time)}`}
              className="w-44 flex-shrink-0 cursor-pointer text-left transition-transform hover:-translate-y-0.5"
            >
              <img
                src={f.src}
                alt={`关键帧 ${formatTime(f.time)}`}
                onError={() => setHiddenIdx((prev) => new Set(prev).add(i))}
                className="aspect-video w-full rounded-lg border border-[#e5e6eb] object-cover"
              />
              <div className="mt-1.5 flex items-start gap-1.5">
                <span className="mt-0.5 flex-shrink-0 rounded-md bg-[#e8f3ff] px-1.5 py-0.5 font-mono text-[10px] text-[#165dff]">
                  {formatTime(f.time)}
                </span>
                <span className="line-clamp-2 text-xs leading-5 text-[#4e5969]">
                  {f.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
