"use client";

import type { StudyNote } from "@/lib/learning-types";
import { formatTime } from "@/lib/learning";
import { learningProgressLabel, learningStatus, LEARNING_STATUS_LABELS } from "@/lib/learning-progress";

interface Props {
  note: StudyNote;
  onToggle: (index: number) => void;
  onReview: () => void;
  onReference: (time: number) => void;
}

export default function LearningProgressPanel({ note, onToggle, onReview, onReference }: Props) {
  const chapters = note.analysis.result.segments;
  const completed = note.learning?.completedChapters ?? [];
  return <section className="study-panel mb-4" aria-label="学习进度与复习">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">学习进度与复习</h2>
      <p className="text-sm text-muted" role="status">{learningProgressLabel(note)} · {LEARNING_STATUS_LABELS[learningStatus(note)]}</p>
    </div>
    <p className="mt-2 text-sm leading-6 text-muted">学完一章后勾选，复习后手动记录一次。记录保存在当前浏览器，在线分析过期后仍可更新。</p>
    {chapters.length > 0 ? <>
      <progress className="study-progress mt-3" aria-label="章节学习进度" max={chapters.length} value={completed.length} />
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">逐章标记学习进度</summary>
        <div className="max-h-72 divide-y divide-line overflow-y-auto">
          {chapters.map((chapter, index) => <div key={index} className="flex items-center gap-3 py-2">
            <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand" checked={completed.includes(index)} onChange={() => onToggle(index)} />
              <span className="min-w-0 break-words"><span className="mr-2 text-muted">{formatTime(chapter.start)}</span>{chapter.title}</span>
            </label>
            <button type="button" className="study-button shrink-0" aria-label={`查看章节原文：${chapter.title}`} onClick={() => onReference(chapter.start)}>查看原文</button>
          </div>)}
        </div>
      </details>
    </> : <p className="mt-3 text-sm text-muted">此笔记暂无章节，可直接核对原文或记录复习。</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="study-button" onClick={onReview}>记录一次复习</button>
      <p className="text-sm leading-6 text-muted" role="status">已记录复习 {note.learning?.reviewCount ?? 0} 次{note.learning?.lastReviewedAt ? ` · 最近 ${new Date(note.learning.lastReviewedAt).toLocaleString("zh-CN")}` : " · 尚未复习"}</p>
    </div>
  </section>;
}
