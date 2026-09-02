"use client";

import { memo, useRef, useState } from "react";
import type { VideoInfo } from "@/lib/video-processor";
import Icon from "./Icon";
import KeyframeGallery, { type FrameInfo } from "./KeyframeGallery";

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

function parseTimeToSec(time: string): number {
  const parts = time.split(":").map(Number).reverse();
  return (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
}

export default memo(function ResultPanel({ video, result, transcriptSource, frames }: ResultPanelProps) {
  const [imgError, setImgError] = useState(false);
  const segmentRefs = useRef<(HTMLElement | null)[]>([]);
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleJump = (time: number) => {
    let index = result.segments.findIndex((segment) => segment.start <= time && time <= segment.end);
    if (index < 0) {
      for (let i = result.segments.length - 1; i >= 0; i -= 1) {
        if (result.segments[i].start <= time) {
          index = i;
          break;
        }
      }
    }
    if (index < 0) return;

    segmentRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightIdx(index);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightIdx(null), 2000);
  };

  return (
    <div className="space-y-4">
      <section className="surface-shadow overflow-hidden rounded-[24px] border border-line bg-white p-4 sm:p-5" aria-labelledby="video-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-2xl bg-[#202238] sm:w-48">
            {imgError || !video.thumbnail ? (
              <div className="flex h-full w-full items-center justify-center text-white/70">
                <Icon name="film" size={30} />
              </div>
            ) : (
              // Remote thumbnail domains vary by supported platform, so a plain image is intentional here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={video.thumbnail}
                alt=""
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/65 px-2 py-1 font-mono text-[10px] text-white backdrop-blur">
              <Icon name="clock" size={11} /> {formatDuration(video.duration)}
            </div>
          </div>

          <div className="min-w-0 flex-1 py-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand-strong">
                {transcriptSource === "builtin" ? "原生字幕" : "AI 语音识别"}
              </span>
              {result.videoType && <span className="rounded-full bg-[#e8f8f3] px-2.5 py-1 text-[10px] font-semibold text-[#268c70]">{result.videoType}</span>}
            </div>
            <h2 id="video-title" className="text-lg font-bold leading-7 tracking-[-0.025em] text-ink sm:text-xl">{video.title}</h2>
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className="truncate">{video.uploader || "未知作者"}</span>
              <span className="h-1 w-1 rounded-full bg-faint" />
              <span>{result.segments?.length || 0} 个内容节点</span>
              {frames && frames.length > 0 && <><span className="h-1 w-1 rounded-full bg-faint" /><span>{frames.length} 张关键帧</span></>}
            </p>
          </div>
        </div>
      </section>

      <section className="surface-shadow overflow-hidden rounded-[24px] border border-line bg-white" aria-labelledby="summary-heading">
        <header className="flex items-center gap-3 border-b border-line/80 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon name="sparkles" size={18} />
          </div>
          <div>
            <h2 id="summary-heading" className="text-sm font-bold text-ink">AI 视频笔记</h2>
            <p className="mt-0.5 text-[11px] text-muted">按视频脉络整理，所有要点均可回溯至时间节点</p>
          </div>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-[#d6f1e8] bg-[#f2fbf8] px-2.5 py-1 text-[10px] font-semibold text-[#288b70] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#40bd98]" /> 已完成
          </span>
        </header>

        <div className="p-5 sm:p-7">
          <div className="relative overflow-hidden rounded-2xl border border-brand/10 bg-gradient-to-br from-[#f1efff] via-[#f8f7ff] to-[#f2f8ff] p-5 sm:p-6">
            <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand/10 blur-3xl" />
            <div className="relative">
              <p className="flex items-center gap-2 text-xs font-bold text-brand-strong"><Icon name="bolt" size={15} /> 一句话理解</p>
              <p className="mt-3 text-[15px] font-medium leading-7 text-[#31324a] sm:text-base sm:leading-8">{result.overall}</p>
            </div>
          </div>

          <KeyframeGallery frames={frames} onJumpToTime={handleJump} />

          {result.segments && result.segments.length > 0 && (
            <div className="mt-8">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-ink">视频脉络</p>
                  <p className="mt-1 text-xs text-muted">按时间顺序阅读核心内容</p>
                </div>
                <span className="font-mono text-[10px] text-faint">{String(result.segments.length).padStart(2, "0")} CHAPTERS</span>
              </div>

              <div>
                {result.segments.map((segment, index) => (
                  <div key={`${segment.start}-${segment.title}`} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 sm:grid-cols-[44px_minmax(0,1fr)] sm:gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-xl border font-mono text-[10px] font-bold transition-all ${highlightIdx === index ? "border-brand bg-brand text-white ring-4 ring-brand/15" : "border-brand/20 bg-brand-soft text-brand"}`}>
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      {index < result.segments.length - 1 && <span className="w-px flex-1 bg-gradient-to-b from-brand/25 to-line" />}
                    </div>

                    <article
                      ref={(element) => { segmentRefs.current[index] = element; }}
                      className={`mb-4 rounded-2xl border p-4 transition-all duration-300 sm:p-5 ${highlightIdx === index ? "border-brand/40 bg-brand-soft/40 shadow-[0_0_0_4px_rgba(99,91,255,.08)]" : "border-line bg-white hover:border-brand/20 hover:shadow-md"}`}
                    >
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <h3 className="text-sm font-bold leading-6 text-ink sm:text-[15px]">{segment.title}</h3>
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-faint">
                          <Icon name="clock" size={12} /> {formatDuration(segment.start)} — {formatDuration(segment.end)}
                        </span>
                      </div>
                      <ul className="mt-4 space-y-3">
                        {segment.points.map((point, pointIndex) => (
                          <li key={`${point.time}-${pointIndex}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 text-sm leading-6 text-muted">
                            <button
                              type="button"
                              onClick={() => handleJump(parseTimeToSec(point.time))}
                              className="mt-0.5 rounded-lg bg-brand-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                              aria-label={`定位到 ${point.time}`}
                            >
                              {point.time}
                            </button>
                            <span>{point.text}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
});
