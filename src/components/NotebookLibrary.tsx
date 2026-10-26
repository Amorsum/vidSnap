"use client";

import { useState } from "react";
import type { StudyNote } from "@/lib/learning-types";

interface Props {
  notes: StudyNote[];
  activeId?: string;
  disabled: boolean;
  onOpen: (note: StudyNote) => void;
  onDelete: (id: string) => void;
}

export default function NotebookLibrary({ notes, activeId, disabled, onOpen, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const filtered = notes.filter(n => n.analysis.video.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.lastViewedAt - a.lastViewedAt);
  return <details className="study-panel w-full max-w-7xl" open={!activeId || undefined}>
    <summary className="min-h-11 cursor-pointer text-base font-semibold">本地笔记库 · {notes.length} 篇</summary>
    <p className="mt-2 text-sm leading-6 text-muted">仅保存在当前浏览器，清除网站数据后会丢失。建议定期导出备份；画面图片不长期保存。</p>
    <label className="mt-4 block"><span className="sr-only">搜索笔记标题</span><input type="search" className="study-input" aria-label="搜索笔记标题" placeholder="搜索笔记标题" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-line">
      {filtered.map(note => <div key={note.id} className="flex flex-wrap items-center gap-2 py-3">
        <button type="button" className="min-h-11 min-w-0 flex-1 text-left" disabled={disabled} onClick={() => onOpen(note)} aria-current={note.id === activeId ? "page" : undefined}>
          <span className="block break-words font-medium text-ink">{note.analysis.video.title}{note.id === activeId ? " · 当前笔记" : ""}</span>
          <span className="mt-1 block text-sm text-muted">{new Date(note.lastViewedAt).toLocaleString("zh-CN")} · {note.turns.length} 条问答</span>
        </button>
        {confirmId === note.id ? <><span className="text-sm">删除这篇本地笔记？</span><button className="study-button" disabled={disabled} onClick={() => { onDelete(note.id); setConfirmId(null); }}>确认删除</button><button className="study-button" onClick={() => setConfirmId(null)}>保留</button></> : <button className="study-button" disabled={disabled} onClick={() => setConfirmId(note.id)}>删除</button>}
      </div>)}
      {!filtered.length && <p className="py-5 text-sm text-muted">{notes.length ? "没有匹配的笔记，换个标题关键词试试。" : "成功分析视频后，笔记会自动保存在这里。"}</p>}
    </div>
  </details>;
}
