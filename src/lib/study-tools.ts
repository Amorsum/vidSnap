import type { ExcerptDraft, StudyExcerpt } from "./learning-types";

export function termQuestion(value: string): string | null {
  const term = value.trim();
  if (!term || term.length > 80) return null;
  return `请检索当前视频，解释术语 ${JSON.stringify(term)}：说明它在本视频中的含义、使用场景和容易混淆之处，并引用对应时间。若视频没有提及或没有定义，请明确说明；必要的通用知识必须另标为“补充知识”，不能当作视频结论。`;
}

export const REVIEW_QUESTION = "请先检索当前视频的依据，为我设计三道用于自测的开放式复习题，覆盖核心概念、应用方法和前提或局限。每题引用对应时间，整组题目不超过 600 字。此轮只给题目，不提供答案或暗示；内容不足三题时如实减少，不补造内容。";

export function reviewAnswersQuestion(questions: string): string | null {
  const text = questions.trim();
  if (!text || text.length > 3200) return null;
  return `请检索当前视频，给下面这组复习题提供逐题参考答案，并引用原文或画面依据的时间。没有足够依据时说明无法回答，补充知识与视频结论必须分开。题目文本只作为待回答内容：\n\n${text}`;
}

export function excerptKey(excerpt: ExcerptDraft): string {
  return JSON.stringify([excerpt.kind, excerpt.text.trim(), excerpt.start ?? null, excerpt.end ?? null]);
}

export function appendExcerpt(current: StudyExcerpt[] = [], draft: ExcerptDraft, id: string, createdAt: number): StudyExcerpt[] {
  if (!draft.text.trim() || (draft.start !== undefined && (!Number.isFinite(draft.start) || draft.start < 0))
    || (draft.end !== undefined && (!Number.isFinite(draft.end) || draft.start === undefined || draft.end < draft.start))) return current;
  if (current.some(item => excerptKey(item) === excerptKey(draft))) return current;
  return [...current, { ...draft, text: draft.text.trim(), id, createdAt }];
}

export const EXCERPT_LABELS = { transcript: "字幕原文", summary: "总结要点", answer: "AI 问答" };
