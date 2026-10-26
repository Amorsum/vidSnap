"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import URLInput from "./URLInput";
import ProcessingStatus, { type ProgressStep } from "./ProcessingStatus";
import ResultPanel from "./ResultPanel";
import ChatPanel from "./ChatPanel";
import FollowUpInput from "./FollowUpInput";
import TranscriptPanel from "./TranscriptPanel";
import NotebookLibrary from "./NotebookLibrary";
import StudyTools from "./StudyTools";
import ExcerptPanel from "./ExcerptPanel";
import type { ExcerptDraft, StudyNote, StudyTurn } from "@/lib/learning-types";
import { appendExcerpt, excerptKey, reviewAnswersQuestion } from "@/lib/study-tools";
import { durableNote, exportMarkdown, formatTime, sourceUrl, transcriptionLabel, visionLabel } from "@/lib/learning";
import { deleteNote, listNotes, saveNote } from "@/lib/notebook";
import { readProcessResult, retryDeadline } from "@/lib/process-stream";

interface Props { accessCode: string; onUnauthorized: () => void; children: ReactNode }
type Tab = "summary" | "transcript" | "chat";
const tabs: { id: Tab; label: string }[] = [{ id: "summary", label: "总结" }, { id: "transcript", label: "原文" }, { id: "chat", label: "追问" }];

export default function LearningWorkspace({ accessCode, onUnauthorized, children }: Props) {
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [note, setNote] = useState<StudyNote | null>(null);
  const current = useRef<StudyNote | null>(null);
  const [storage, setStorage] = useState("正在打开本地笔记库…");
  const [storageFailed, setStorageFailed] = useState(false);
  const [studyMessage, setStudyMessage] = useState("");
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const writeVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const [step, setStep] = useState<ProgressStep>("downloading");
  const [progress, setProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [lastUrl, setLastUrl] = useState("");
  const [processRetryAt, setProcessRetryAt] = useState(0);
  const [askRetryAt, setAskRetryAt] = useState(0);
  const [tab, setTab] = useState<Tab>("summary");
  const [selection, setSelection] = useState<{ time: number; sequence: number } | null>(null);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const asking = useRef(false);
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable" | "network">("checking");
  const [statusVersion, setStatusVersion] = useState(0);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const processController = useRef<AbortController | null>(null);
  const followupController = useRef<AbortController | null>(null);

  const chooseTab = useCallback((next: Tab) => {
    setTab(next);
    if (next === "transcript") setSelection(null);
    if (next === "chat" && window.innerWidth < 1280) {
      window.requestAnimationFrame(() => document.getElementById("panel-chat")?.scrollIntoView({ block: "start", behavior: "auto" }));
    }
  }, []);

  const showNote = useCallback((next: StudyNote | null) => { current.current = next; setNote(next); }, []);

  const persist = useCallback((next: StudyNote) => {
    const snapshot = durableNote(next);
    setNotes(items => [snapshot, ...items.filter(item => item.id !== next.id)]);
    const version = ++writeVersion.current;
    setStorage("正在保存到当前浏览器…");
    writeQueue.current = writeQueue.current.then(async () => {
      await saveNote(snapshot);
      if (writeVersion.current === version) { setStorage("已保存到当前浏览器"); setStorageFailed(false); }
    }).catch(() => {
      setStorage("本地保存失败。页面内容仍在，请导出备份后重试保存。");
      setStorageFailed(true);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    void listNotes().then(items => {
      if (disposed) return;
      setNotes(items);
      setStorage("笔记仅保存在当前浏览器，清除网站数据后会丢失");
      if (!current.current && !busy.current && items[0]) {
        const restored = { ...items[0], lastViewedAt: Date.now() };
        showNote(restored);
        persist(restored);
      }
    }).catch(() => { if (!disposed) { setStorage("无法打开本地笔记库，仍可分析和导出。原有数据未删除。"); setStorageFailed(true); } });
    return () => { disposed = true; };
  }, [persist, showNote]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => document.documentElement.style.setProperty("--study-viewport", `${viewport?.height ?? window.innerHeight}px`);
    resize();
    viewport?.addEventListener("resize", resize);
    return () => { viewport?.removeEventListener("resize", resize); document.documentElement.style.removeProperty("--study-viewport"); };
  }, []);

  useEffect(() => () => { processController.current?.abort(); followupController.current?.abort(); }, []);

  const analysisId = note?.analysis.analysisId;
  useEffect(() => {
    if (!analysisId) return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}`, { headers: { "X-Access-Code": accessCode }, cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted || current.current?.analysis.analysisId !== analysisId) return;
        if (response.status === 401) { onUnauthorized(); return; }
        setAvailability(response.ok && data.canFollowUp ? "available" : response.status === 404 || response.ok ? "unavailable" : "network");
      } catch { if (!controller.signal.aborted && current.current?.analysis.analysisId === analysisId) setAvailability("network"); }
    };
    void check();
    window.addEventListener("focus", check);
    return () => { controller.abort(); window.removeEventListener("focus", check); };
  }, [analysisId, accessCode, onUnauthorized, statusVersion]);

  const update = useCallback((transform: (value: StudyNote) => StudyNote) => {
    if (!current.current) return;
    const next = transform(current.current);
    showNote(next);
    persist(next);
  }, [persist, showNote]);

  const submit = useCallback(async (url: string) => {
    if (busy.current || asking.current || processRetryAt > Date.now()) return;
    busy.current = true;
    const controller = new AbortController();
    processController.current = controller;
    setLoading(true); setError(""); setLastUrl(url); setStep("downloading"); setProgress(0); setGenerating(false);
    const start = Date.now(); setStartedAt(start); setNow(start);
    try {
      const response = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json", "X-Access-Code": accessCode }, body: JSON.stringify({ url, action: "summarize" }), signal: controller.signal });
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) {
        if (response.status === 429) setProcessRetryAt(retryDeadline(response.headers.get("Retry-After")));
        const data = await response.json();
        throw new Error(data.error || (response.status === 400 ? "链接无效，请检查后重试" : "处理请求失败，请重试"));
      }
      const analysis = await readProcessResult(response, event => {
        if (["downloading", "transcribing", "vision", "analyzing"].includes(event.step)) setStep(event.step as ProgressStep);
        if (typeof event.percent === "number" && Number.isFinite(event.percent)) setProgress(p => Math.max(p, Math.min(95, event.percent!)));
      }, () => setGenerating(true));
      const old = current.current;
      const time = Date.now();
      // 有效缓存属于同一分析；复用本地笔记，过期后新分析另建笔记保留旧问答。
      const existing = old?.analysis.analysisId === analysis.analysisId ? old : notes.find(saved => saved.analysis.analysisId === analysis.analysisId);
      const next: StudyNote = existing ? { ...existing, analysis, updatedAt: time, lastViewedAt: time } : {
        id: crypto.randomUUID(), version: 1, analysis, turns: [], personalNote: "", createdAt: time, updatedAt: time, lastViewedAt: time,
      };
      showNote(next); persist(next); setAvailability("available"); setTab("summary"); setSelection(null); setStudyMessage("");
      setStep("done"); setProgress(100);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof TypeError ? "网络请求失败，请检查网络连接后重试" : failure instanceof Error ? failure.message : "处理失败，请重试");
    } finally { busy.current = false; setLoading(false); setGenerating(false); }
  }, [accessCode, notes, onUnauthorized, persist, processRetryAt, showNote]);

  const canAsk = !!note && availability === "available" && note.analysis.expiresAt > now && !loading && !followUpLoading;
  const ask = useCallback(async (question: string, purpose: StudyTurn["purpose"] = "question") => {
    const active = current.current;
    if (!active || asking.current || busy.current || availability !== "available" || active.analysis.expiresAt <= Date.now() || askRetryAt > Date.now()) return;
    asking.current = true;
    setFollowUpLoading(true); chooseTab("chat");
    const turnId = Date.now();
    const id = active.id;
    const controller = new AbortController(); followupController.current = controller;
    const change = (answer: string, status: "success" | "error", toolsUsed?: string[]) => {
      if (current.current?.id !== id) return;
      update(value => ({ ...value, updatedAt: Date.now(), turns: value.turns.map(t => t.id === turnId ? { ...t, answer, status, toolsUsed } : t) }));
    };
    showNote({ ...active, turns: [...active.turns, { id: turnId, question, answer: "", status: "pending", purpose }] });
    try {
      const response = await fetch("/api/followup", { method: "POST", headers: { "Content-Type": "application/json", "X-Access-Code": accessCode }, body: JSON.stringify({ analysisId: active.analysis.analysisId, videoId: active.analysis.video.id, question }), signal: controller.signal });
      const data = await response.json();
      if (response.status === 401) { change("访问码已失效，请重新验证后重试。", "error"); onUnauthorized(); return; }
      if (response.status === 429) setAskRetryAt(retryDeadline(response.headers.get("Retry-After")));
      if (response.status === 404) setAvailability("unavailable");
      if (!response.ok || !data.success || typeof data.answer !== "string") throw new Error(data.error || "追问失败，请重试");
      change(data.answer, "success", Array.isArray(data.toolsUsed) ? data.toolsUsed.filter((v: unknown) => typeof v === "string") : undefined);
    } catch (failure) { if (!controller.signal.aborted) change(failure instanceof Error ? failure.message : "网络请求失败，请重试", "error"); }
    finally { asking.current = false; setFollowUpLoading(false); }
  }, [accessCode, askRetryAt, availability, chooseTab, onUnauthorized, showNote, update]);

  const reference = useCallback((time: number) => {
    setSelection({ time, sequence: Date.now() }); setTab("transcript");
    workspace.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

  const excerptKeys = useMemo(() => new Set(note?.excerpts?.map(excerptKey) ?? []), [note?.excerpts]);
  const addExcerpt = useCallback((draft: ExcerptDraft) => {
    const active = current.current;
    if (!active) return;
    const excerpts = appendExcerpt(active.excerpts, draft, crypto.randomUUID(), Date.now());
    if (excerpts === active.excerpts) { setStudyMessage("这段内容已在重点摘录中。"); return; }
    update(value => ({ ...value, excerpts, updatedAt: Date.now() }));
    setStudyMessage("已加入重点摘录，可在总结下方查看和导出。");
  }, [update]);

  const reviewAnswers = (questions: string) => {
    const question = reviewAnswersQuestion(questions);
    if (question) void ask(question, "review_answers");
    else setStudyMessage("这组题目过长，请选择其中一题继续追问。");
  };

  const open = (saved: StudyNote) => {
    if (busy.current || asking.current) return;
    const next = { ...saved, lastViewedAt: Date.now() };
    showNote(next); persist(next); setAvailability("checking"); setTab("summary"); setSelection(null); setError(""); setLastUrl("");
    setStatusVersion(version => version + 1);
    setStudyMessage("");
  };

  const remove = (id: string) => {
    if (busy.current || asking.current) return;
    writeQueue.current = writeQueue.current.then(async () => {
      await deleteNote(id);
      setNotes(items => items.filter(n => n.id !== id));
      if (current.current?.id === id) showNote(null);
      setStorage("本地笔记已删除；服务器临时数据仍按原期限清理。");
    }).catch(() => { setStorage("删除失败，原笔记已保留，请重试。"); setStorageFailed(true); });
  };

  const download = () => {
    if (!note) return;
    const url = URL.createObjectURL(new Blob([exportMarkdown(note, includeTranscript)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${note.analysis.video.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "视频笔记"}.md`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const processWait = Math.max(0, Math.ceil((processRetryAt - now) / 1000));
  const askWait = Math.max(0, Math.ceil((askRetryAt - now) / 1000));
  return <main className="relative z-10 flex flex-1 flex-col items-center gap-5 px-4 pb-10 sm:px-8">
    <section className={`w-full max-w-7xl ${note ? "pt-6" : "pt-12 sm:pt-16"}`}>
      <h1 className={`${note ? "text-2xl" : "text-3xl sm:text-5xl"} font-bold tracking-tight text-ink`}>{note ? "视频学习工作台" : "把视频读懂，把知识留下"}</h1>
      <p className="mb-5 mt-3 text-base leading-7 text-muted">{note ? "核对原文、追问细节，把理解整理成自己的笔记。" : "粘贴 YouTube 或抖音链接，阅读总结、核对原文，随时继续追问。"}</p>
      <URLInput key={note?.id ?? "new"} onSubmit={submit} isLoading={loading || followUpLoading || processWait > 0} initialValue={lastUrl || note?.analysis.canonicalUrl} />
    </section>

    <div className="w-full max-w-7xl text-sm text-muted"><span role="status">{storage}</span>{storageFailed && note && <button className="study-button ml-2" onClick={() => persist(note)}>重试保存</button>}</div>
    <NotebookLibrary notes={notes} activeId={note?.id} disabled={loading || followUpLoading} onOpen={open} onDelete={remove} />

    {(loading || error) && <ProcessingStatus isLoading={loading} step={step} progress={progress} elapsed={Math.max(0, Math.floor((now - startedAt) / 1000))} errorMessage={error || undefined} retrySeconds={processWait} onRetry={lastUrl ? () => void submit(lastUrl) : undefined} />}
    {loading && generating && <section className="study-panel w-full max-w-3xl" role="status" aria-label="正在生成总结">
      <h2 className="text-base font-semibold">正在整理可阅读的总结</h2><p className="mt-2 text-sm text-muted">内容完整后会自动展示。你已有的笔记仍保留在下方。</p>
      <div className="mt-5 space-y-3" aria-hidden="true">{["w-2/3", "w-full", "w-4/5"].map(width => <div key={width} className={`h-4 rounded bg-surface-soft motion-safe:animate-pulse ${width}`} />)}</div>
    </section>}

    {!note && !loading && !error && children}
    {note && <section ref={workspace} className="study-workspace w-full max-w-7xl scroll-mt-20" aria-label="视频学习结果">
      <div className="study-panel mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted"><span>{transcriptionLabel(note.analysis)}</span><span>·</span><span>{note.analysis.transcription.timing === "estimated" ? "时间为估算值" : note.analysis.transcription.timing === "source" ? "时间来自字幕或识别结果" : "时间精度未知"}</span></div>
        <p className="text-sm text-muted">{visionLabel(note.analysis.vision)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <a className="study-button inline-flex" href={sourceUrl(note.analysis)} target="_blank" rel="noopener noreferrer">打开原视频</a>
          <button type="button" className="study-button" onClick={download}>导出 Markdown</button>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeTranscript} onChange={e => setIncludeTranscript(e.target.checked)} />包含字幕原文</label>
        </div>
      </div>

      <StudyTools disabled={!canAsk || askWait > 0} onAsk={ask} />
      {studyMessage && <p role="status" className="mb-4 text-sm text-brand-strong">{studyMessage}</p>}

      <div className="study-tabs mb-4 flex gap-1" role="tablist" aria-label="学习内容">
        {tabs.map(item => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold ${tab === item.id ? "bg-brand text-white" : "bg-white text-ink"}`} onClick={() => chooseTab(item.id)} onKeyDown={event => {
          const index = tabs.findIndex(t => t.id === tab);
          const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
          if (next >= 0) { event.preventDefault(); chooseTab(tabs[next].id); document.getElementById(`tab-${tabs[next].id}`)?.focus(); }
        }}>{item.label}</button>)}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className={`min-w-0 ${tab === "chat" ? "hidden xl:block" : ""}`}>
          <div id="panel-summary" role="tabpanel" aria-labelledby="tab-summary" hidden={tab === "transcript"}>
            <ResultPanel key={note.id} video={note.analysis.video} result={note.analysis.result} transcriptSource={note.analysis.transcriptSource} frames={note.analysis.frames.map(f => ({ ...f, src: (note.analysis.framesExpireAt ?? 0) > now ? f.src : undefined }))} onReference={reference} canAsk={canAsk && askWait === 0} onExplain={(start, end, title) => void ask(`请解释 ${formatTime(start)} 到 ${formatTime(end)} 的「${title}」，基于该段原文说明核心概念，并引用时间。`)} onExcerpt={addExcerpt} excerptKeys={excerptKeys} />
            <ExcerptPanel excerpts={note.excerpts ?? []} onReference={reference} onRemove={id => update(value => ({ ...value, excerpts: value.excerpts?.filter(item => item.id !== id), updatedAt: Date.now() }))} />
            <section className="study-panel mt-4"><label htmlFor="personal-note" className="text-base font-semibold">我的笔记</label><p className="mb-3 mt-2 text-sm text-muted">写下你的理解、疑问或下一步行动。</p><textarea id="personal-note" className="study-input min-h-40 resize-y" value={note.personalNote} placeholder="这段视频对我有什么启发？" onChange={e => update(value => ({ ...value, personalNote: e.target.value, updatedAt: Date.now() }))} /></section>
          </div>
          <div id="panel-transcript" role="tabpanel" aria-labelledby="tab-transcript" hidden={tab !== "transcript"}>
            {tab === "transcript" && <><TranscriptPanel key={`${note.id}-${selection?.sequence ?? "search"}`} analysis={note.analysis} selection={selection} onExcerpt={addExcerpt} excerptKeys={excerptKeys} />{selection && <button className="study-button mt-3" onClick={() => setSelection(null)}>返回字幕搜索</button>}</>}
          </div>
        </div>
        <aside id="panel-chat" role="tabpanel" aria-labelledby="tab-chat" className={`study-chat study-panel ${tab !== "chat" ? "hidden xl:flex" : "flex"}`}>
          <div className="mb-3 text-sm leading-6 text-muted" role="status">
            {availability === "checking" ? "正在检查是否可以继续追问…" : availability === "network" ? "暂时无法确认在线状态，笔记仍可阅读和导出。" : note.analysis.expiresAt <= now || availability === "unavailable" ? "在线数据已过期或不可用，本地笔记仍可阅读。重新分析后开启新的问答，旧问答保留在本地。" : "可基于当前视频继续追问。时间引用可能存在偏差。"}
            {(availability === "unavailable" || note.analysis.expiresAt <= now) && <button className="study-button mt-2" disabled={loading || followUpLoading || processWait > 0} onClick={() => void submit(note.analysis.canonicalUrl)}>重新分析以继续追问</button>}
            {availability === "network" && <button className="study-button mt-2" onClick={() => { setAvailability("checking"); setStatusVersion(v => v + 1); }}>重试检查</button>}
          </div>
          <ChatPanel key={note.id} conversation={note.turns} followUpLoading={followUpLoading} onExample={ask} onReference={reference} canAsk={canAsk && askWait === 0} onExcerpt={addExcerpt} excerptKeys={excerptKeys} onReviewAnswers={reviewAnswers} />
          <div className="study-composer mt-3 border-t border-line pt-3">
            {askWait > 0 && <p className="mb-2 text-sm" role="status">请求较多，{askWait} 秒后可重试。</p>}
            <FollowUpInput onSubmit={ask} isLoading={!canAsk || askWait > 0} />
            {note.turns.at(-1)?.status === "error" && <button className="study-button mt-2" disabled={!canAsk || askWait > 0} onClick={() => { const last = current.current?.turns.at(-1); if (last) void ask(last.question, last.purpose); }}>重试上个问题</button>}
          </div>
        </aside>
      </div>
    </section>}
  </main>;
}
