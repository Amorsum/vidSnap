import { createHash } from "node:crypto";
import type { AnalysisResult } from "./learning-types";
import { auditCitations } from "./citation-audit";

type Verdict = "unreviewed" | "supported" | "contradicted" | "insufficient";
interface Review {
  verdict: Verdict;
  evidenceIds: string[];
  reason: string;
}

/** 核查表仅供人工编辑；时间候选不自动转为事实判断。 */
export function prepareEvidenceReview(analysis: AnalysisResult) {
  const audit = auditCitations(analysis);
  const sources = [
    ...analysis.transcriptSegments.map((segment, index) => ({ id: `t${index}`, start: segment.start, end: segment.end, text: segment.text })),
    ...analysis.frames.map((frame, index) => ({ id: `f${index}`, start: frame.time, end: frame.time, text: frame.description })),
  ];
  const claims = [
    { id: "overall", text: analysis.result.overall, candidates: [] as string[] },
    ...analysis.result.segments.flatMap((chapter, ci) => chapter.points.map((point, pi) => {
      const location = audit.chapters[ci].points[pi];
      return { id: `c${ci}p${pi}`, text: point.text,
        candidates: [...location.transcriptIndexes.map(i => `t${i}`), ...location.frameIndexes.map(i => `f${i}`)] };
    })),
  ];
  const structure = analysis.result.segments.map(chapter => ({ start: chapter.start, end: chapter.end, times: chapter.points.map(point => point.time) }));
  const context = { duration: analysis.video.duration, timing: analysis.transcription.timing, structure, sources, claims };
  return {
    version: 1,
    inputSha256: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
    timing: analysis.transcription.timing,
    sources,
    claims: claims.map(claim => ({ ...claim, review: { verdict: "unreviewed", evidenceIds: [], reason: "" } as Review })),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 对照原始输入校验，拒绝删掉困难要点、替换证据或引用不存在的证据。 */
export function summarizeEvidenceReview(analysis: AnalysisResult, worksheet: unknown) {
  const expected = prepareEvidenceReview(analysis);
  const invalid = () => new Error("核查表与输入不匹配或核查结果不完整");
  if (!record(worksheet) || worksheet.version !== 1 || worksheet.inputSha256 !== expected.inputSha256
    || worksheet.timing !== expected.timing || JSON.stringify(worksheet.sources) !== JSON.stringify(expected.sources)
    || !Array.isArray(worksheet.claims) || worksheet.claims.length !== expected.claims.length) throw invalid();
  const counts = { unreviewed: 0, supported: 0, contradicted: 0, insufficient: 0 };
  const sourceIds = new Set(expected.sources.filter(source => source.text.trim()).map(source => source.id));
  for (const [i, claim] of worksheet.claims.entries()) {
    const original = expected.claims[i];
    if (!record(claim) || claim.id !== original.id || claim.text !== original.text
      || JSON.stringify(claim.candidates) !== JSON.stringify(original.candidates) || !record(claim.review)) throw invalid();
    const review = claim.review;
    if (typeof review.verdict !== "string" || !Object.hasOwn(counts, review.verdict)
      || typeof review.reason !== "string" || review.reason.length > 4000 || !Array.isArray(review.evidenceIds)
      || review.evidenceIds.some(id => typeof id !== "string" || !sourceIds.has(id))
      || new Set(review.evidenceIds).size !== review.evidenceIds.length) throw invalid();
    const verdict = review.verdict as Verdict;
    if (verdict === "unreviewed" ? review.reason.trim() || review.evidenceIds.length
      : !review.reason.trim() || ((verdict === "supported" || verdict === "contradicted") && !review.evidenceIds.length)) throw invalid();
    counts[verdict]++;
  }
  const total = expected.claims.length;
  const reviewed = total - counts.unreviewed;
  return { inputSha256: expected.inputSha256, assessment: "human-entered", total, reviewed, counts,
    complete: counts.unreviewed === 0,
    supportedAmongReviewed: reviewed ? counts.supported / reviewed : null };
}
