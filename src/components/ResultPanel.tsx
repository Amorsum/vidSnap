"use client";

import { memo, useRef, useState } from "react";
import type { VideoInfo } from "@/lib/video-processor";
import KeyframeGallery, { type FrameInfo } from "./KeyframeGallery";

/** AI 总结结果结构（与 SSE result 载荷一致） */
export interface SummaryResult {
  overall: string;
  videoType?: string;
  segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[];
}

interface ResultPanelProps {
  video: VideoInfo;
  result: SummaryResult;
  transcriptSource: "builtin" | "whisper";
  frames?: FrameInfo[];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// memo：追问状态变化会触发父组件重渲染，结果区内容不变时跳过整棵 segments 树
export default memo(function ResultPanel({ video, result, transcriptSource, frames }: ResultPanelProps) {
  const [imgError, setImgError] = useState(false);
  // 时间跳转：滚动定位到对应分段并短暂高亮（关键帧点击 / 时间戳胶囊点击共用）
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleJump = (t: number) => {
    // 优先找覆盖该时刻的分段，否则取最后一个起点在 t 之前的分段
    let idx = result.segments.findIndex((seg) => seg.start <= t && t <= seg.end);
    if (idx < 0) {
      idx = -1;
      for (let i = result.segments.length - 1; i >= 0; i--) {
        if (result.segments[i].start <= t) { idx = i; break; }
      }
    }
    if (idx < 0) return;
    segmentRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightIdx(idx);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightIdx(null), 2000);
  };

  const parseTimeToSec = (time: string): number => {
    const [m, s] = time.split(":").map(Number);
    return (m || 0) * 60 + (s || 0);
  };

  return (
    <div className="w-full space-y-5">
      {/* 视频信息卡片 */}
      <div className="flex gap-4 rounded-[10px] border border-[#e5e6eb] bg-white p-4 shadow-sm">
        {imgError || !video.thumbnail ? (
          <div className="flex h-24 w-40 flex-shrink-0 items-center justify-center rounded-lg bg-[#f2f3f5]">
            <span className="text-3xl">🎬</span>
          </div>
        ) : (
          <img
            src={video.thumbnail}
            alt={video.title}
            onError={() => setImgError(true)}
            className="h-24 w-40 flex-shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[#1d2129]">{video.title}</h2>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-[#86909c]">
            <span>{video.uploader}</span>
            <span className="h-3 w-px bg-[#e5e6eb]" />
            <span>{formatDuration(video.duration)}</span>
            <span className="h-3 w-px bg-[#e5e6eb]" />
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${transcriptSource === "builtin" ? "bg-[#e8f3ff] text-[#165dff]" : "bg-[#f2f3f5] text-[#86909c]"}`}>
              {transcriptSource === "builtin" ? "自带字幕" : "AI 识别"}
            </span>
          </div>
        </div>
      </div>

      {/* AI 总结 */}
      <div className="rounded-[10px] border border-[#e5e6eb] bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="text-sm font-semibold text-[#1d2129]">AI 总结</h3>
          {result.videoType && (
            <span className="rounded-full bg-[#e8f3ff] px-2 py-0.5 text-[10px] text-[#165dff]">
              {result.videoType}
            </span>
          )}
        </div>

        {/* 一句话总结 */}
        <div className="mb-6 rounded-lg bg-[#f7f8fa] px-4 py-3">
          <p className="text-xs text-[#86909c]">💡 一句话总结</p>
          <p className="mt-1 text-sm text-[#1d2129]">{result.overall}</p>
        </div>

        {/* 关键帧画廊：视觉理解结果，点击跳转到对应时间轴分段 */}
        <KeyframeGallery frames={frames} onJumpToTime={handleJump} />

        {/* 时间轴分段 */}
        {result.segments && result.segments.length > 0 && (
          <div>
            <p className="mb-4 text-sm font-medium text-[#86909c]">📍 时间轴分段</p>
            <div>
              {result.segments.map((seg, i) => (
                <div key={i} className="flex gap-3">
                  {/* 时间轴节点（圆点 + 连接线） */}
                  <div className="flex flex-col items-center">
                    <span className="mt-5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-[#165dff]" />
                    {i < result.segments.length - 1 && (
                      <span className="w-px flex-1 bg-[#e5e6eb]" />
                    )}
                  </div>
                  {/* 片段内容 */}
                  <div
                    ref={(el) => { segmentRefs.current[i] = el; }}
                    className={`flex-1 rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm ${
                      highlightIdx === i ? "border-[#165dff] ring-2 ring-[#165dff]/40" : "border-[#e5e6eb]"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-[#1d2129]">{seg.title}</h4>
                      <span className="text-xs text-[#86909c]">
                        {formatDuration(seg.start)} - {formatDuration(seg.end)}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {seg.points.map((point, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-[#4e5969]">
                          <button
                            onClick={() => handleJump(parseTimeToSec(point.time))}
                            className="mt-0.5 flex-shrink-0 cursor-pointer rounded-md bg-[#e8f3ff] px-1.5 py-0.5 font-mono text-[10px] text-[#165dff] transition-colors hover:bg-[#165dff] hover:text-white"
                          >
                            {point.time}
                          </button>
                          <span>{point.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
