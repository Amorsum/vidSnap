"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, ExcerptDraft } from "@/lib/learning-types";
import { formatTime, sourceUrl } from "@/lib/learning";
import { excerptKey } from "@/lib/study-tools";

interface Props { analysis: AnalysisResult; selection: { time: number; sequence: number } | null; onExcerpt?: (draft: ExcerptDraft) => void; excerptKeys?: ReadonlySet<string> }

function highlight(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const parts = [];
  let at = 0, found;
  while ((found = lower.indexOf(needle, at)) >= 0) {
    parts.push(text.slice(at, found), <mark key={found} className="bg-brand-soft text-brand-strong">{text.slice(found, found + query.length)}</mark>);
    at = found + query.length;
  }
  parts.push(text.slice(at));
  return parts;
}

export default function TranscriptPanel({ analysis, selection, onExcerpt, excerptKeys }: Props) {
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [limit, setLimit] = useState(200);
  const target = useRef<HTMLDivElement>(null);
  const needle = query.trim();
  const matches = analysis.transcriptSegments.map((s, index) => ({ ...s, index }))
    .filter(s => !needle || s.text.toLocaleLowerCase().includes(needle.toLocaleLowerCase()));
  const selectedIndex = selection ? analysis.transcriptSegments.findIndex(s => s.start <= selection.time && selection.time < s.end) : -1;
  // 引用跳转优先于搜索，始终展示真实的时间范围匹配，不把最近字幕冒充引用。
  const rows = selection ? analysis.transcriptSegments.map((s, index) => ({ ...s, index })) : matches;
  const activeIndex = selection ? selectedIndex : matches[Math.min(hit, matches.length - 1)]?.index;
  const count = selection && selectedIndex >= 0 ? Math.max(limit, selectedIndex + 1) : Math.max(limit, hit + 1);
  const frames = selection ? analysis.frames.filter(f => Math.abs(f.time - selection.time) <= 5) : [];

  useEffect(() => { target.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); }, [selection, hit]);

  return <section className="study-panel" aria-labelledby="transcript-heading">
    <h2 id="transcript-heading" className="text-lg font-semibold">字幕原文</h2>
    <p className="mt-2 text-sm text-muted">{analysis.transcription.timing === "estimated" ? "时间由语音识别文本估算，仅供参考。" : analysis.transcription.timing === "source" ? "时间来自字幕或识别结果，可能存在偏差。" : "时间精度未知，仅供参考。"}</p>
    {!selection && <div className="my-4 flex flex-wrap items-center gap-2">
      <label className="min-w-0 flex-1"><span className="sr-only">搜索字幕</span><input type="search" aria-label="搜索字幕" className="study-input" placeholder="搜索术语或关键词" value={query} onChange={e => { setQuery(e.target.value); setHit(0); setLimit(200); }} /></label>
      {needle && <><span className="text-sm" role="status">{matches.length ? `${hit + 1} / ${matches.length}` : "没有找到匹配字幕"}</span><button className="study-button" disabled={!matches.length} onClick={() => setHit(h => (h - 1 + matches.length) % matches.length)}>上一处</button><button className="study-button" disabled={!matches.length} onClick={() => setHit(h => (h + 1) % matches.length)}>下一处</button></>}
    </div>}
    {selection && <div className="my-4 space-y-3 rounded-xl bg-surface-soft p-4" role="status">
      <p>正在核对 {formatTime(selection.time)}{analysis.transcription.timing === "estimated" ? "（估算时间）" : ""}</p>
      {selectedIndex < 0 && <p className="text-sm">该时间没有对应字幕，不能据此确认文字依据。</p>}
      {frames.map((f, i) => <p key={i} className="text-sm leading-6"><strong>画面依据 [{formatTime(f.time)}]：</strong>{f.description}</p>)}
      <a className="study-button inline-flex" href={sourceUrl(analysis, selection.time)} target="_blank" rel="noopener noreferrer">打开原视频{analysis.platform === "douyin" ? `（参考 ${formatTime(selection.time)}，需手动定位）` : ` ${formatTime(selection.time)}`}</a>
    </div>}
    <div className="max-h-[60dvh] space-y-2 overflow-y-auto" aria-label="字幕列表">
      {rows.slice(0, count).map(s => <div key={s.index} ref={s.index === activeIndex ? target : undefined} className={`rounded-xl p-3 ${s.index === activeIndex ? "bg-brand-soft ring-2 ring-brand/30" : "bg-surface-soft/60"}`}>
        <a href={sourceUrl(analysis, s.start)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand" aria-label={`打开原视频 ${formatTime(s.start)}`}>{formatTime(s.start)} — {formatTime(s.end)}</a>
        <p className="text-base leading-7 text-ink">{highlight(s.text, needle)}</p>
        {onExcerpt && <button type="button" className="study-button mt-2" disabled={excerptKeys?.has(excerptKey({ kind: "transcript", text: s.text, start: s.start, end: s.end }))} onClick={() => onExcerpt({ kind: "transcript", text: s.text, start: s.start, end: s.end })}>{excerptKeys?.has(excerptKey({ kind: "transcript", text: s.text, start: s.start, end: s.end })) ? "已摘录" : "摘录原文"}</button>}
      </div>)}
      {!analysis.transcriptSegments.length && analysis.transcriptText.trim() ? <div className="rounded-xl bg-surface-soft p-3">
        <p className="mb-2 text-sm text-muted">此笔记仅保留字幕全文，没有分段时间，无法按秒定位。</p>
        <p className="whitespace-pre-wrap break-words text-base leading-7">{highlight(analysis.transcriptText, needle)}</p>
      </div> : !rows.length && <p className="py-8 text-sm text-muted">{needle ? "换一个关键词试试。" : "本次没有可用字幕。"}</p>}
      {rows.length > count && <button className="study-button w-full" onClick={() => setLimit(count + 200)}>显示更多字幕</button>}
    </div>
  </section>;
}
