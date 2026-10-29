import type { LearningProgress, StudyNote } from "./learning-types";

export const LEARNING_STATUS_LABELS = { unstarted: "待学习", in_progress: "学习中", completed: "已学完" };
export type LearningStatus = keyof typeof LEARNING_STATUS_LABELS;

export function isLearningProgress(value: unknown, chapterCount: number): value is LearningProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!("completedChapters" in value) || !Array.isArray(value.completedChapters)
    || value.completedChapters.length > chapterCount || !value.completedChapters.every(index => Number.isInteger(index) && index >= 0 && index < chapterCount)
    || new Set(value.completedChapters).size !== value.completedChapters.length) return false;
  if (!("reviewCount" in value) || typeof value.reviewCount !== "number" || !Number.isSafeInteger(value.reviewCount) || value.reviewCount < 0) return false;
  const reviewedAt = "lastReviewedAt" in value ? value.lastReviewedAt : undefined;
  if (value.reviewCount === 0) return reviewedAt === undefined;
  return typeof reviewedAt === "number" && Number.isSafeInteger(reviewedAt) && reviewedAt > 0 && reviewedAt <= 8.64e15;
}

export function copyLearningProgress(value?: LearningProgress): LearningProgress | undefined {
  return value && { completedChapters: [...value.completedChapters].sort((a, b) => a - b), reviewCount: value.reviewCount, lastReviewedAt: value.lastReviewedAt };
}

export function learningStatus(note: StudyNote): LearningStatus {
  const count = note.learning?.completedChapters.length ?? 0;
  const total = note.analysis.result.segments.length;
  return total > 0 && count === total ? "completed" : count > 0 ? "in_progress" : "unstarted";
}

export function learningProgressLabel(note: StudyNote): string {
  return `已学 ${note.learning?.completedChapters.length ?? 0}/${note.analysis.result.segments.length} 章节`;
}

export function toggleChapter(note: StudyNote, index: number, now = Date.now()): StudyNote {
  if (!Number.isInteger(index) || index < 0 || index >= note.analysis.result.segments.length) return note;
  const learning = copyLearningProgress(note.learning) ?? { completedChapters: [], reviewCount: 0 };
  const completed = new Set(learning.completedChapters);
  if (completed.has(index)) completed.delete(index); else completed.add(index);
  return { ...note, learning: { ...learning, completedChapters: [...completed].sort((a, b) => a - b) }, updatedAt: now };
}

export function recordReview(note: StudyNote, now = Date.now()): StudyNote {
  if (!Number.isFinite(now) || now <= 0 || now > 8.64e15) return note;
  const learning = copyLearningProgress(note.learning) ?? { completedChapters: [], reviewCount: 0 };
  if (learning.reviewCount === Number.MAX_SAFE_INTEGER) return note;
  return { ...note, learning: { ...learning, reviewCount: learning.reviewCount + 1, lastReviewedAt: now }, updatedAt: now };
}
