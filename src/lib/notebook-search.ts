import type { StudyNote } from "./learning-types";

export const NOTEBOOK_QUERY_LIMIT = 200;
export const NOTEBOOK_MATCH_LIMIT = 3;
export const NOTEBOOK_MATCH_LABELS = { title: "视频标题", personal: "个人笔记", excerpt: "重点摘录", question: "历史问题", answer: "历史回答", summary: "视频总结", transcript: "字幕原文" };
export type NotebookMatchKind = keyof typeof NOTEBOOK_MATCH_LABELS;

interface SearchDocument { kind: NotebookMatchKind; text: string; start?: number; turnId?: number }
export interface NotebookMatch extends SearchDocument { at: number; matched: string }
export interface NotebookSearchResult { note: StudyNote; matches: NotebookMatch[] }

function literalPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
}

/** 逐字段检索，保留来源定位；不把不同来源拼接成虚假的连续命中。 */
function* documents(note: StudyNote): Generator<SearchDocument> {
  yield { kind: "title", text: note.analysis.video.title };
  yield { kind: "personal", text: note.personalNote };
  for (const item of note.excerpts ?? []) yield { kind: "excerpt", text: item.text, start: item.start };
  for (const turn of note.turns) {
    if (turn.status !== "success") continue;
    yield { kind: "question", text: turn.question, turnId: turn.id };
    yield { kind: "answer", text: turn.answer, turnId: turn.id };
  }
  yield { kind: "summary", text: note.analysis.result.overall };
  for (const segment of note.analysis.result.segments) {
    yield { kind: "summary", text: segment.title, start: segment.start };
    for (const point of segment.points) yield { kind: "summary", text: point.text, start: segment.start };
  }
  for (const segment of note.analysis.transcriptSegments) yield { kind: "transcript", text: segment.text, start: segment.start };
  if (!note.analysis.transcriptSegments.length) yield { kind: "transcript", text: note.analysis.transcriptText };
}

export function searchNotebook(notes: StudyNote[], query: string): NotebookSearchResult[] {
  const needle = query.trim();
  if (!needle) return notes.map(note => ({ note, matches: [] }));
  if (needle.length > NOTEBOOK_QUERY_LIMIT) return [];
  const pattern = literalPattern(needle);
  const results: NotebookSearchResult[] = [];
  for (const note of notes) {
    const matches: NotebookMatch[] = [];
    const seen = new Set<string>();
    for (const document of documents(note)) {
      const match = pattern.exec(document.text);
      if (!match) continue;
      const key = JSON.stringify([document.kind, document.text, document.start, document.turnId]);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ ...document, at: match.index, matched: match[0] });
      if (matches.length === NOTEBOOK_MATCH_LIMIT) break;
    }
    if (matches.length) results.push({ note, matches });
  }
  return results;
}

/** 按 Unicode 字符截取上下文，保留原始文字，不解释为 HTML。 */
export function notebookSnippet(match: NotebookMatch): { before: string; matched: string; after: string } {
  const before = match.text.slice(0, match.at);
  const after = match.text.slice(match.at + match.matched.length);
  const left = Array.from(before).slice(-30).join("");
  const right = Array.from(after).slice(0, 60).join("");
  return { before: `${left.length < before.length ? "…" : ""}${left}`, matched: match.matched, after: `${right}${right.length < after.length ? "…" : ""}` };
}
