import { formatTime, summaryPointSeconds } from "./learning";
import type { AnalysisResult, SummaryResult, TranscriptionMetadata } from "./learning-types";

type EvidenceInputs = Pick<AnalysisResult, "transcriptSegments" | "frames">;

export function resolveSummaryEvidence(id: unknown, duration: number, inputs: EvidenceInputs) {
  if (typeof id !== "string" || !/^[tf](?:0|[1-9]\d{0,8})$/.test(id)) return null;
  const index = Number(id.slice(1));
  const kind = id[0] === "t" ? "transcript" : "frame";
  const segment = kind === "transcript" ? inputs.transcriptSegments[index] : undefined;
  const frame = kind === "frame" ? inputs.frames[index] : undefined;
  const start = segment?.start ?? frame?.time;
  const end = segment?.end ?? frame?.time;
  if (!(segment?.text ?? frame?.description)?.trim() || start === undefined || end === undefined
    || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > duration || end < start
    || (kind === "transcript" && (end === start || start === duration))) return null;
  return { id, kind, index, start, end: Math.min(end, duration) };
}

/** 只保留可定位的引用。估算字幕只提供段落起点，无法精确到段落内部。 */
export function normalizeSummaryCitations(summary: SummaryResult, duration: number,
  transcript: EvidenceInputs["transcriptSegments"], timing: TranscriptionMetadata["timing"],
  frames: EvidenceInputs["frames"] = []) {
  const evidence = transcript.filter(segment => segment.text.trim());
  const frameSeconds = new Set(frames.filter(frame => frame.description.trim()).map(frame => Math.floor(frame.time)));
  return {
    ...summary,
    segments: summary.segments.map(chapter => ({
      ...chapter,
      start: Math.min(chapter.start, duration),
      end: Math.min(chapter.end, duration),
      points: chapter.points.map(point => {
        if (point.evidenceId !== undefined) {
          const source = resolveSummaryEvidence(point.evidenceId, duration, { transcriptSegments: transcript, frames });
          if (source) {
            const time = formatTime(source.start);
            if (summaryPointSeconds(time, chapter, duration) !== null) return { text: point.text, time, evidenceId: source.id };
          }
          return { text: point.text, time: "" };
        }
        const time = summaryPointSeconds(point.time, chapter, duration);
        const located = time !== null && (frameSeconds.has(time) || evidence.some(segment =>
          timing === "source" ? time >= Math.floor(segment.start) && time <= segment.end : time === Math.floor(segment.start)));
        return located ? point : { ...point, time: "" };
      }),
    })),
  };
}
