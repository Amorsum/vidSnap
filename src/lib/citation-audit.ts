import { parseTime } from "./learning";
import type { AnalysisResult } from "./learning-types";

export type CitationIssue = "invalid_time" | "outside_video" | "outside_chapter" | "no_temporal_evidence";

/** 只检查时间位置，不判断要点是否由证据支持，不将估算字幕视为精确对齐。 */
export function auditCitations(analysis: AnalysisResult) {
  const chapters = analysis.result.segments.map((chapter, chapterIndex) => ({
    chapterIndex,
    outsideVideo: chapter.start > analysis.video.duration || chapter.end > analysis.video.duration,
    points: chapter.points.map((point, pointIndex) => {
      const seconds = parseTime(point.time);
      const issues: CitationIssue[] = [];
      if (seconds === null) issues.push("invalid_time");
      else {
        if (seconds > analysis.video.duration) issues.push("outside_video");
        // Prompt 将开始时间向下取整到秒；只容许由此产生的不足一秒偏差。
        if (seconds < Math.floor(chapter.start) || seconds > chapter.end) issues.push("outside_chapter");
      }
      const transcriptIndexes = seconds === null ? [] : analysis.transcriptSegments.flatMap((segment, index) =>
        segment.text.trim() && seconds >= Math.floor(segment.start) && seconds <= segment.end ? [index] : []);
      const frameIndexes = seconds === null ? [] : analysis.frames.flatMap((frame, index) =>
        frame.description.trim() && seconds === Math.floor(frame.time) ? [index] : []);
      if (seconds !== null && !transcriptIndexes.length && !frameIndexes.length) issues.push("no_temporal_evidence");
      return { pointIndex, seconds, transcriptIndexes, frameIndexes, issues };
    }),
  }));
  const points = chapters.flatMap(chapter => chapter.points);
  return {
    version: 1,
    scope: "temporal-only",
    transcriptionTiming: analysis.transcription.timing,
    factualSupport: "not_evaluated",
    totalPoints: points.length,
    flaggedPoints: points.filter(point => point.issues.length).length,
    flaggedChapters: chapters.filter(chapter => chapter.outsideVideo).length,
    emptySummary: points.length === 0,
    chapters,
  };
}
