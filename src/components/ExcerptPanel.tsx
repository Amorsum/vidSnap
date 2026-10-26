"use client";

import type { StudyExcerpt } from "@/lib/learning-types";
import { EXCERPT_LABELS } from "@/lib/study-tools";
import { formatTime } from "@/lib/learning";

interface Props { excerpts: StudyExcerpt[]; onRemove: (id: string) => void; onReference: (time: number) => void }

export default function ExcerptPanel({ excerpts, onRemove, onReference }: Props) {
  return <section className="study-panel mt-4" aria-labelledby="excerpts-heading">
    <h2 id="excerpts-heading" className="text-base font-semibold">重点摘录 · {excerpts.length} 条</h2>
    <p className="mt-2 text-sm leading-6 text-muted">从字幕、总结和成功问答中摘录。保存在当前笔记，可随 Markdown 导出；AI 内容与原文分开标注。</p>
    {!excerpts.length && <p className="mt-4 text-sm text-muted">遇到值得复习的内容，点击“摘录”留下它。</p>}
    <div className="mt-3 space-y-3">
      {[...excerpts].reverse().map(item => <article key={item.id} className="rounded-xl bg-surface-soft/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{EXCERPT_LABELS[item.kind]}{item.start !== undefined && <button type="button" className="study-button ml-2" onClick={() => { if (item.start !== undefined) onReference(item.start); }} aria-label={`查看摘录原文 ${formatTime(item.start)}`}>{formatTime(item.start)}</button>}</p>
          <button type="button" className="study-button" onClick={() => onRemove(item.id)} aria-label={`移除摘录：${item.text.slice(0, 20)}`}>移除</button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-base leading-7">{item.text}</p>
      </article>)}
    </div>
  </section>;
}
