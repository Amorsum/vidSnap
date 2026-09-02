"use client";

import { useState } from "react";
import Icon from "./Icon";

export interface FrameInfo {
  time: number;
  src: string;
  description: string;
}

interface KeyframeGalleryProps {
  frames?: FrameInfo[];
  onJumpToTime?: (time: number) => void;
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default function KeyframeGallery({ frames, onJumpToTime }: KeyframeGalleryProps) {
  const [hiddenIndexes, setHiddenIndexes] = useState<Set<number>>(new Set());

  if (!frames?.length) return null;
  const visibleFrames = frames.map((frame, index) => ({ frame, index })).filter(({ index }) => !hiddenIndexes.has(index));
  if (!visibleFrames.length) return null;

  return (
    <section className="mt-8" aria-labelledby="keyframes-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h3 id="keyframes-heading" className="flex items-center gap-2 text-sm font-bold text-ink">
            <Icon name="image" size={16} className="text-brand" /> 关键画面
          </h3>
          <p className="mt-1 text-xs text-muted">点击画面，快速定位对应内容节点</p>
        </div>
        <span className="rounded-full bg-surface-soft px-2.5 py-1 text-[10px] font-semibold text-muted">{visibleFrames.length} FRAMES</span>
      </div>

      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3">
        {visibleFrames.map(({ frame, index }, displayIndex) => (
          <button
            key={`${frame.time}-${index}`}
            type="button"
            onClick={() => onJumpToTime?.(frame.time)}
            className="group w-[78%] max-w-64 shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-white text-left transition-all hover:-translate-y-1 hover:border-brand/25 hover:shadow-lg sm:w-56"
            aria-label={`定位到 ${formatTime(frame.time)}：${frame.description}`}
          >
            <div className="relative aspect-video overflow-hidden bg-surface-soft">
              {/* Frame URLs are generated dynamically by the local signed frame endpoint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={frame.src}
                alt={frame.description || `关键画面 ${displayIndex + 1}`}
                onError={() => setHiddenIndexes((current) => new Set(current).add(index))}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/65 to-transparent" />
              <span className="absolute bottom-2 left-2 rounded-lg bg-black/45 px-2 py-1 font-mono text-[10px] font-semibold text-white backdrop-blur-md">
                {formatTime(frame.time)}
              </span>
              <span className="absolute bottom-2 right-2 flex h-7 w-7 translate-y-1 items-center justify-center rounded-lg bg-white/90 text-brand opacity-0 shadow-sm transition-all group-hover:translate-y-0 group-hover:opacity-100">
                <Icon name="chevron-right" size={14} />
              </span>
            </div>
            <div className="p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-brand">SHOT {String(displayIndex + 1).padStart(2, "0")}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-muted">{frame.description || "视频关键画面"}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
