import { summaryPointSeconds } from "./learning";
import type { SummaryResult, TranscriptionMetadata } from "./learning-types";

/** 只保留可定位的引用。估算字幕只提供段落起点，无法精确到段落内部。 */
export function normalizeSummaryCitations(summary: SummaryResult, duration: number,
  transcript: readonly { start: number; end: number; text: string }[], timing: TranscriptionMetadata["timing"],
  frames: readonly { time: number; description: string }[] = []) {
  const evidence = transcript.filter(segment => segment.text.trim());
  const frameSeconds = new Set(frames.filter(frame => frame.description.trim()).map(frame => Math.floor(frame.time)));
  return {
    ...summary,
    segments: summary.segments.map(chapter => ({
      ...chapter,
      start: Math.min(chapter.start, duration),
      end: Math.min(chapter.end, duration),
      points: chapter.points.map(point => {
        const time = summaryPointSeconds(point.time, chapter, duration);
        const located = time !== null && (frameSeconds.has(time) || evidence.some(segment =>
          timing === "source" ? time >= Math.floor(segment.start) && time <= segment.end : time === Math.floor(segment.start)));
        return located ? point : { ...point, time: "" };
      }),
    })),
  };
}
