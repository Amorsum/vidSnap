"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { StudyNote } from "@/lib/learning-types";
import { BACKUP_MAX_BYTES, exportNotebook, parseNotebookBackup } from "@/lib/notebook-backup";
import { learningProgressLabel, learningStatus, LEARNING_STATUS_LABELS, type LearningStatus } from "@/lib/learning-progress";
import { NOTEBOOK_QUERY_LIMIT, NOTEBOOK_MATCH_LABELS, notebookSnippet, searchNotebook, type NotebookMatch } from "@/lib/notebook-search";
import { formatTime } from "@/lib/learning";

interface Props {
  notes: StudyNote[];
  activeId?: string;
  disabled: boolean;
  onOpen: (note: StudyNote, match?: NotebookMatch) => void;
  onDelete: (id: string) => void;
  onImport: (notes: StudyNote[]) => Promise<{ added: number; skipped: number; copies: number }>;
}

export default function NotebookLibrary({ notes, activeId, disabled, onOpen, onDelete, onImport }: Props) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = query !== deferredQuery;
  const searchResults = useMemo(() => searchNotebook(notes, deferredQuery), [notes, deferredQuery]);
  const [statusFilter, setStatusFilter] = useState<LearningStatus | "all">("all");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ filename: string; notes: StudyNote[] } | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const blocked = disabled || working;
  const backup = () => {
    try {
      const text = exportNotebook(notes);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = `vidsnap-notebook-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`已生成 ${notes.length} 篇笔记的备份，请妥善保存下载文件。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "备份失败，请重试。"); }
  };
  const selectFile = async (file?: File) => {
    setPending(null); setMessage("");
    if (!file) return;
    setWorking(true);
    try {
      if (file.size > BACKUP_MAX_BYTES) throw new Error("备份文件不能超过 20 MiB。");
      setPending({ filename: file.name, notes: parseNotebookBackup(await file.text()) });
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取备份，请重新选择文件。"); }
    finally { setWorking(false); }
  };
  const restore = async () => {
    if (!pending || blocked) return;
    setWorking(true); setMessage("正在导入，请保持页面打开…");
    try {
      const result = await onImport(pending.notes);
      setMessage(`导入完成：新增 ${result.added} 篇，跳过重复 ${result.skipped} 篇${result.copies ? `，其中 ${result.copies} 篇以副本保留` : ""}。`);
      setPending(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败，原有笔记已保留，请重试。"); }
    finally { setWorking(false); }
  };
  const filtered = searchResults.filter(({ note }) => statusFilter === "all" || learningStatus(note) === statusFilter)
    .sort((a, b) => b.note.lastViewedAt - a.note.lastViewedAt);
  return <details className="study-panel w-full max-w-7xl" open={!activeId || undefined}>
    <summary className="min-h-11 cursor-pointer text-base font-semibold">本地笔记库 · {notes.length} 篇</summary>
    <p className="mt-2 text-sm leading-6 text-muted">仅保存在当前浏览器，清除网站数据后会丢失。备份包含字幕、笔记、摘录与问答，可在其他浏览器导入；不含画面图片。</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="study-button" disabled={blocked || !notes.length} onClick={backup}>备份全部笔记</button>
      <button type="button" className="study-button" disabled={blocked} onClick={() => fileInput.current?.click()}>导入笔记备份</button>
      <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" aria-label="选择笔记备份文件" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file); }} />
    </div>
    {pending && <section className="mt-3 rounded-xl border border-line p-3" aria-label="确认笔记导入">
      <p className="break-words text-sm leading-6">{pending.filename} · {pending.notes.length} 篇笔记</p>
      <ul className="mt-1 text-sm leading-6 text-muted">{pending.notes.slice(0, 3).map((item, index) => <li className="break-words" key={index}>{item.analysis.video.title}</li>)}</ul>
      <p className="mt-2 text-sm leading-6 text-muted">相同内容跳过，同一篇笔记有不同内容时保留为副本，不覆盖现有笔记。文件仅在浏览器内处理；导入不会恢复服务器上的追问资格。</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="study-button" disabled={blocked} onClick={() => void restore()}>确认导入</button><button type="button" className="study-button" disabled={working} onClick={() => { setPending(null); setMessage(""); }}>取消导入</button></div>
    </section>}
    <p className="mt-2 break-words text-sm leading-6 text-muted" role="status">{working && !message ? "正在读取备份…" : message}</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="block min-w-0 flex-1"><span className="sr-only">搜索笔记内容</span><input type="search" className="study-input" aria-label="搜索笔记内容" placeholder="搜索标题、字幕、笔记或问答" maxLength={NOTEBOOK_QUERY_LIMIT} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="block text-sm"><span className="mb-1 block text-muted">学习状态</span><select className="study-input min-h-11" aria-label="筛选学习状态" value={statusFilter} onChange={event => {
        const value = event.target.value;
        if (value === "all" || value === "unstarted" || value === "in_progress" || value === "completed") setStatusFilter(value);
      }}><option value="all">全部笔记</option>{Object.entries(LEARNING_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {query.trim() && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted"><span role="status">{searching ? "正在搜索本地笔记…" : `找到 ${filtered.length} 篇笔记，每篇最多显示 3 处命中。`}</span><button type="button" className="study-button" onClick={() => setQuery("")}>清空搜索</button></div>}
    <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-line" aria-busy={searching}>
      {filtered.map(({ note, matches }) => <div key={note.id} className="flex flex-wrap items-center gap-2 py-3">
        <button type="button" className="min-h-11 min-w-0 flex-1 text-left" disabled={blocked || searching} onClick={() => onOpen(note)} aria-current={note.id === activeId ? "page" : undefined}>
          <span className="block break-words font-medium text-ink">{note.analysis.video.title}{note.id === activeId ? " · 当前笔记" : ""}</span>
          <span className="mt-1 block text-sm text-muted">{new Date(note.lastViewedAt).toLocaleString("zh-CN")} · {note.turns.length} 条问答</span>
          <span className="mt-1 block text-sm text-muted">{LEARNING_STATUS_LABELS[learningStatus(note)]} · {learningProgressLabel(note)} · 复习 {note.learning?.reviewCount ?? 0} 次</span>
        </button>
        {confirmId === note.id ? <><span className="text-sm">删除这篇本地笔记？</span><button className="study-button" disabled={blocked} onClick={() => { onDelete(note.id); setConfirmId(null); }}>确认删除</button><button className="study-button" onClick={() => setConfirmId(null)}>保留</button></> : <button className="study-button" disabled={blocked} onClick={() => setConfirmId(note.id)}>删除</button>}
        {matches.length > 0 && <div className="w-full space-y-2">{matches.map((match, index) => {
          const snippet = notebookSnippet(match);
          return <button type="button" key={index} className="min-h-11 w-full rounded-lg bg-surface-soft p-3 text-left text-sm leading-6" disabled={blocked || searching} onClick={() => onOpen(note, match)} aria-label={`打开命中：${NOTEBOOK_MATCH_LABELS[match.kind]} · ${note.analysis.video.title} · ${index + 1}`}>
            <span className="block text-muted">{NOTEBOOK_MATCH_LABELS[match.kind]}{match.start === undefined ? "" : ` · ${note.analysis.transcription.timing === "estimated" ? "约 " : ""}${formatTime(match.start)}`}</span>
            <span className="block break-words">{snippet.before}<mark className="bg-brand-soft text-brand-strong">{snippet.matched}</mark>{snippet.after}</span>
          </button>;
        })}</div>}
      </div>)}
      {!filtered.length && <p className="py-5 text-sm text-muted">{notes.length ? "没有匹配的笔记，试试其他搜索词或学习状态。" : "成功分析视频后，笔记会自动保存在这里。"}</p>}
    </div>
  </details>;
}
