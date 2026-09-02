"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Header from "@/components/Header";
import URLInput from "@/components/URLInput";
import ProcessingStatus, { type ProgressStep } from "@/components/ProcessingStatus";
import ResultPanel, { type SummaryResult } from "@/components/ResultPanel";
import type { FrameInfo } from "@/components/KeyframeGallery";
import ChatPanel, { type Turn } from "@/components/ChatPanel";
import FollowUpInput from "@/components/FollowUpInput";
import Footer from "@/components/Footer";
import Icon from "@/components/Icon";
import { sseLines } from "@/lib/sse";
import type { VideoInfo } from "@/lib/video-processor";

interface ProcessResult {
  video: VideoInfo;
  transcriptSource: "builtin" | "whisper";
  transcriptText: string;
  transcriptSegments: { start: number; end: number; text: string }[];
  result: SummaryResult;
  frames?: FrameInfo[];
}

// 追问条目的自增 id（模块级，用于按身份更新，避免按下标覆盖错条目）
let turnIdSeq = 0;

function LandingPreview() {
  return (
    <section className="animate-rise-in mt-12 w-full max-w-5xl" aria-label="VidSnap 功能预览">
      <div className="surface-shadow overflow-hidden rounded-[28px] border border-white/80 bg-white/75 p-3 backdrop-blur sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[1.45fr_0.75fr]">
          <div className="rounded-[22px] border border-line/80 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-3 border-b border-line/70 pb-4">
              <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[#262b46] to-[#6964ab]">
                <div className="absolute inset-0 dot-grid opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  <Icon name="play" size={19} className="fill-current" />
                </div>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">如何用 AI 重新设计工作流</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <Icon name="clock" size={13} /> 18:42 · 已完成视频理解
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-soft to-[#f6f5ff] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-brand-strong">
                <Icon name="sparkles" size={15} /> 核心结论
              </div>
              <p className="text-sm leading-6 text-[#353552]">将重复任务交给 AI，人的价值会从“执行”转向“定义问题和判断结果”。</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {["重新定义问题", "构建 AI 工作流", "保留人的判断"].map((item, index) => (
                <div key={item} className="rounded-xl border border-line/70 px-3 py-3">
                  <span className="font-mono text-[10px] font-semibold text-brand">0{index + 1}</span>
                  <p className="mt-1 text-xs font-medium text-muted">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-64 flex-col rounded-[22px] bg-[#181a2a] p-4 text-white sm:p-5">
            <div className="flex items-center gap-2 border-b border-white/10 pb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-[#bdb8ff]">
                <Icon name="message" size={16} />
              </div>
              <div>
                <p className="text-xs font-semibold">询问视频 Agent</p>
                <p className="mt-0.5 text-[10px] text-white/45">基于字幕与画面回答</p>
              </div>
              <span className="ml-auto h-2 w-2 rounded-full bg-[#4fd1a9] shadow-[0_0_0_4px_rgba(79,209,169,.12)]" />
            </div>
            <div className="flex flex-1 flex-col justify-center gap-3 py-5">
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-xs">视频中最值得实践的建议是什么？</div>
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white/9 px-3 py-2.5 text-xs leading-5 text-white/75">先选择一个每周重复三次以上的流程，再将其中可验证的环节交给 AI。 <span className="text-[#aaa4ff]">[06:18]</span></div>
            </div>
            <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[11px] text-white/35">继续追问视频内容…<Icon name="send" size={13} className="ml-auto" /></div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { icon: "captions" as const, title: "字幕识别", detail: "自动转写" },
          { icon: "image" as const, title: "画面理解", detail: "关键帧视觉分析" },
          { icon: "message" as const, title: "内容追问", detail: "秒级溯源" },
        ].map((item) => (
          <div key={item.title} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/55 px-2 py-3 text-center backdrop-blur sm:flex-row sm:justify-start sm:px-4 sm:text-left">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon name={item.icon} size={15} /></div>
            <div><p className="text-xs font-semibold text-ink">{item.title}</p><p className="mt-0.5 hidden text-[10px] text-faint sm:block">{item.detail}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<ProgressStep>();
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [streamingText, setStreamingText] = useState<string>("");

  const [conversation, setConversation] = useState<Turn[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // ─── 访问码门禁 ───
  const [mounted, setMounted] = useState(false);
  const [gatePassed, setGatePassed] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [gateError, setGateError] = useState("");
  const [gateChecking, setGateChecking] = useState(false);

  // 已有访问码（localStorage / URL 参数 ?code=xxx）则直接放行，后台校验失效码自动退回门禁
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem("vidsnap_access_code") || "";
      const urlCode = new URLSearchParams(window.location.search).get("code") || "";
      const candidate = stored || urlCode;
      if (candidate) {
        setAccessCode(candidate);
        setGatePassed(true);
        if (urlCode) {
          localStorage.setItem("vidsnap_access_code", urlCode);
          history.replaceState({}, "", window.location.pathname); // 清除 URL 中的码
        }
        fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: candidate }),
        })
          .then((response) => (response.status === 401 ? { invalid: true } : response.json()))
          .then((data) => {
            // 仅在确认访问码失效时退回门禁（429 等暂时性失败不影响已放行的用户）
            if (data?.invalid) {
              localStorage.removeItem("vidsnap_access_code");
              setAccessCode("");
              setGatePassed(false);
            }
          })
          .catch(() => {});
      }
      setMounted(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleGateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = accessCode.trim();
    if (!code || gateChecking) return;
    setGateChecking(true);
    setGateError("");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem("vidsnap_access_code", code);
        setGatePassed(true);
      } else {
        setGateError(data.error || "访问码错误");
      }
    } catch {
      setGateError("网络请求失败，请稍后重试");
    } finally {
      setGateChecking(false);
    }
  };

  const handleSubmit = useCallback(async (url: string) => {
    setIsLoading(true);
    setErrorMessage(undefined);
    setResult(null);
    setStreamingText("");
    setProgressStep("downloading");
    setProgressPercent(0);
    setConversation([]);
    // 新视频开始时重置追问状态，避免残留的「正在输入…」
    setFollowUpLoading(false);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Access-Code": accessCode },
        body: JSON.stringify({ url, action: "summarize" }),
      });

      if (!response.ok) {
        // 非流式错误（400 等）；401 说明访问码失效，退回门禁页
        if (response.status === 401) {
          localStorage.removeItem("vidsnap_access_code");
          setAccessCode("");
          setGatePassed(false);
          setIsLoading(false);
          return;
        }
        const data = await response.json();
        setProgressStep("error");
        setErrorMessage(data.error || "请求失败");
        setIsLoading(false);
        return;
      }

      // 读取 SSE 流
      const reader = response.body?.getReader();
      if (!reader) {
        setProgressStep("error");
        setErrorMessage("无法读取响应流");
        setIsLoading(false);
        return;
      }

      for await (const line of sseLines(reader)) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "progress") {
              setProgressStep(event.step as ProgressStep);
              if (typeof event.percent === "number") {
                setProgressPercent(event.percent);
              }
            } else if (event.type === "result") {
              setProgressStep("done");
              setResult(event.data);
              setStreamingText("");
            } else if (event.type === "error") {
              setProgressStep("error");
              setErrorMessage(event.message);
            } else if (event.type === "stream") {
              // AI 流式输出增量
              setStreamingText(prev => prev + event.text);
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }
    } catch {
      setProgressStep("error");
      setErrorMessage("网络请求失败，请检查网络连接后重试");
    } finally {
      setIsLoading(false);
    }
  }, [accessCode]);

  // 当前在途追问的条目 id：只有它才能清除 loading，防止过期响应误清新追问的状态
  const inFlightTurnRef = useRef<number | null>(null);

  const handleFollowUp = useCallback(async (question: string) => {
    // 已有追问进行中时忽略新请求（避免并发请求互相覆盖答案）
    if (!result || followUpLoading) return;
    setFollowUpLoading(true);
    const turnId = ++turnIdSeq;
    inFlightTurnRef.current = turnId;
    // 立即显示用户的问题（像微信发送消息），answer 先留空
    setConversation((prev) => [...prev, { id: turnId, question, answer: "" }]);

    // 按条目 id 更新答案；若期间会话被清空（用户换了新视频），过期响应自然被丢弃
    const updateTurn = (answer: string, toolsUsed?: string[]) => {
      setConversation((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, answer, toolsUsed } : t))
      );
    };

    try {
      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Access-Code": accessCode },
        body: JSON.stringify({ videoId: result.video.id, question }),
      });
      const data = await response.json();
      if (response.status === 401) {
        // 访问码失效：清码退回门禁页，丢弃本次追问
        localStorage.removeItem("vidsnap_access_code");
        setAccessCode("");
        setGatePassed(false);
        setConversation((prev) => prev.filter((t) => t.id !== turnId));
      } else if (data.success) {
        updateTurn(data.answer, data.toolsUsed);
      } else {
        updateTurn(data.error || "追问失败");
      }
    } catch {
      updateTurn("网络请求失败，请稍后重试");
    } finally {
      if (inFlightTurnRef.current === turnId) {
        inFlightTurnRef.current = null;
        setFollowUpLoading(false);
      }
    }
  }, [result, followUpLoading, accessCode]);

  return (
    <div id="top" className="page-glow relative flex min-h-screen flex-col overflow-x-hidden">
      <div className="dot-grid pointer-events-none absolute inset-x-0 top-16 h-[560px] opacity-40" />
      <Header />

      {!mounted ? null : !gatePassed ? (
        <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
          <div className="surface-shadow grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/80 bg-white lg:grid-cols-[1.08fr_0.92fr]">
            <div className="relative hidden min-h-[480px] overflow-hidden bg-[#181a2a] p-10 text-white lg:flex lg:flex-col lg:justify-between">
              <div className="dot-grid absolute inset-0 opacity-30" />
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/30 blur-3xl" />
              <div className="relative">
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-[#beb9ff] ring-1 ring-white/10">
                  <Icon name="sparkles" size={23} />
                </div>
                <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-[-0.04em]">少看一会儿视频，<br />多得一些答案。</h1>
                <p className="mt-4 max-w-sm text-sm leading-7 text-white/55">VidSnap 会同时理解字幕与画面，将一段视频转换为可快速阅读、随时追问的内容工作台。</p>
              </div>
              <div className="relative grid grid-cols-3 gap-3">
                {[
                  ["01", "字幕 + 画面"],
                  ["02", "时间节点"],
                  ["03", "Agent 追问"],
                ].map(([index, label]) => (
                  <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <span className="font-mono text-[10px] text-[#9f98ff]">{index}</span>
                    <p className="mt-1 text-[11px] text-white/60">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleGateSubmit} className="flex min-h-[440px] flex-col justify-center p-7 sm:p-10 lg:p-12">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <Icon name="lock" size={20} />
              </div>
              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-brand">内部演示</p>
              <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-ink">输入访问码</h1>
              <p className="mt-2 text-sm leading-6 text-muted">这是 VidSnap 的演示环境，请使用站长提供的访问码继续。</p>
              <label htmlFor="access-code" className="mt-7 text-xs font-semibold text-muted">访问码</label>
              <input
                id="access-code"
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="请输入访问码"
                autoFocus
                aria-describedby={gateError ? "gate-error" : undefined}
                className="mt-2 w-full rounded-xl border border-line bg-surface-soft/60 px-4 py-3 text-sm text-ink outline-none transition-all placeholder:text-faint focus:border-brand/50 focus:bg-white focus:ring-4 focus:ring-brand/10"
              />
              {gateError && <p id="gate-error" className="mt-2 text-xs text-red-500" role="alert">{gateError}</p>}
              <button
                type="submit"
                disabled={gateChecking || !accessCode.trim()}
                className="brand-shadow mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-strong disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-[#b8b4ea] disabled:shadow-none"
              >
                {gateChecking ? "正在验证..." : <>进入 VidSnap <Icon name="arrow-right" size={16} /></>}
              </button>
              <p className="mt-5 text-center text-[11px] text-faint">访问码仅保存在当前浏览器</p>
            </form>
          </div>
        </main>
      ) : (
        <main className="relative z-10 flex flex-1 flex-col items-center px-5 pb-16 sm:px-8">
          <section className={`flex w-full flex-col items-center text-center transition-all ${result ? "pb-5 pt-8" : "pb-0 pt-14 sm:pt-20"}`}>
            {!result && (
              <div className="mb-5 flex items-center gap-2 rounded-full border border-brand/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-brand backdrop-blur">
                <Icon name="sparkles" size={14} /> 字幕、画面与 AI 的联合理解
              </div>
            )}
            <h1 className={`${result ? "text-2xl sm:text-3xl" : "max-w-3xl text-4xl leading-[1.12] sm:text-6xl"} font-bold tracking-[-0.055em] text-ink`}>
              {result ? "继续解析下一段视频" : <>把一段视频，变成<br className="hidden sm:block" />可阅读、可追问的<span className="bg-gradient-to-r from-brand to-[#8a68e8] bg-clip-text text-transparent">知识</span></>}
            </h1>
            {!result && <p className="mt-5 max-w-2xl text-sm leading-7 text-muted sm:text-base">粘贴 YouTube 或抖音链接，VidSnap 会识别字幕、阅读关键画面，<br className="hidden sm:block" />为你整理视频脉络，并回答每一个后续问题。</p>}
            <div className={`${result ? "mt-5" : "mt-8"} w-full flex justify-center`}>
              <URLInput onSubmit={handleSubmit} isLoading={isLoading} />
            </div>
            {!result && !isLoading && !errorMessage && <p className="mt-3 text-xs text-faint">目前支持 YouTube · 抖音 · 外语视频自动输出中文</p>}
          </section>

          {(isLoading || errorMessage) && (
            <div className="mt-6 flex w-full justify-center">
              <ProcessingStatus isLoading={isLoading} step={progressStep} progress={progressPercent} errorMessage={errorMessage} />
            </div>
          )}

          {!result && !isLoading && !errorMessage && !streamingText && <LandingPreview />}

          {result && (
            <section className="animate-rise-in mt-5 grid w-full max-w-7xl items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" aria-label="视频分析结果">
              <div className="min-w-0">
                <ResultPanel video={result.video} result={result.result} transcriptSource={result.transcriptSource} frames={result.frames} />
              </div>
              <aside className="surface-shadow flex min-h-[560px] flex-col overflow-hidden rounded-[24px] border border-line bg-white p-4 sm:p-5 xl:sticky xl:top-20 xl:h-[calc(100vh-100px)]" aria-label="视频追问对话">
                <ChatPanel conversation={conversation} followUpLoading={followUpLoading} onExample={handleFollowUp} />
                <div className="border-t border-line/80 pt-3">
                  <FollowUpInput onSubmit={handleFollowUp} isLoading={followUpLoading} />
                  <p className="mt-2 text-center text-[10px] text-faint">Agent 会基于视频原文与画面进行回答</p>
                </div>
              </aside>
            </section>
          )}

          {streamingText && !result && (
            <section className="surface-shadow mt-6 w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-white" aria-live="polite">
              <div className="flex items-center gap-3 border-b border-line/80 px-5 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon name="sparkles" size={17} /></div>
                <div><h2 className="text-sm font-semibold text-ink">AI 正在组织视频脉络</h2><p className="mt-0.5 text-[11px] text-muted">已完成理解，正在生成可阅读的总结</p></div>
                <span className="ml-auto flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:150ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:300ms]" /></span>
              </div>
              <div className="max-h-80 overflow-y-auto bg-surface-soft/60 p-5">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-muted">{streamingText}</pre>
              </div>
            </section>
          )}
        </main>
      )}

      <Footer />
    </div>
  );
}
