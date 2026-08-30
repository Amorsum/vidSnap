"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Header from "@/components/Header";
import URLInput from "@/components/URLInput";
import ProcessingStatus from "@/components/ProcessingStatus";
import ResultPanel from "@/components/ResultPanel";
import ChatPanel, { type Turn } from "@/components/ChatPanel";
import FollowUpInput from "@/components/FollowUpInput";
import Footer from "@/components/Footer";

type ProgressStep = "downloading" | "transcribing" | "analyzing" | "done" | "error";

interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

interface ProcessResult {
  video: VideoInfo;
  transcriptSource: "builtin" | "whisper";
  transcriptText: string;
  transcriptSegments: { start: number; end: number; text: string }[];
  result: { overall: string; videoType?: string; segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[] };
}

// 追问条目的自增 id（模块级，用于按身份更新，避免按下标覆盖错条目）
let turnIdSeq = 0;

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
        .then((r) => (r.status === 401 ? { invalid: true } : r.json()))
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

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
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
    const updateTurn = (answer: string) => {
      setConversation((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, answer } : t))
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
        updateTurn(data.answer);
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
    <div className="flex min-h-screen flex-col">
      <Header />

      {!mounted ? null : !gatePassed ? (
        /* 访问码门禁页 */
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <form onSubmit={handleGateSubmit} className="w-full max-w-sm rounded-[10px] border border-[#e5e6eb] bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <span className="text-3xl">🔒</span>
              <h1 className="mt-3 text-lg font-semibold text-[#1d2129]">需要访问码</h1>
              <p className="mt-1 text-xs text-[#86909c]">本站为内部演示，请向站长获取访问码</p>
            </div>
            <input
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="请输入访问码"
              autoFocus
              className="w-full rounded-lg border border-[#e5e6eb] px-4 py-2.5 text-sm text-[#1d2129] outline-none transition-colors focus:border-[#165dff]"
            />
            {gateError && <p className="mt-2 text-xs text-red-500">{gateError}</p>}
            <button
              type="submit"
              disabled={gateChecking}
              className="mt-4 w-full rounded-lg bg-[#165dff] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4080ff] disabled:cursor-not-allowed disabled:bg-[#94bfff]"
            >
              {gateChecking ? "验证中..." : "进入"}
            </button>
          </form>
        </main>
      ) : (
      <main className="flex flex-1 flex-col items-center px-6 py-12">
        {/* Hero 文案 */}
        <div className="mb-10 max-w-2xl text-center">
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-[#1d2129]">
            AI 视频<span className="text-[#165dff]">总结</span>
          </h1>
          <p className="text-base text-[#86909c]">
            不用从头追到尾，粘贴链接知原委
            <br />
            支持 YouTube / 抖音
          </p>
        </div>

        {/* 输入区域 */}
        <URLInput onSubmit={handleSubmit} isLoading={isLoading} />

        {/* 进度展示 */}
        <div className="mt-6">
          <ProcessingStatus
            isLoading={isLoading}
            step={progressStep}
            progress={progressPercent}
            errorMessage={errorMessage}
          />
        </div>

        {/* 结果展示：左右分栏（左总结、右追问） */}
        {result && (
          <div className="mt-8 grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[1fr_380px]">
            {/* 左：视频总结 */}
            <div className="min-w-0">
              <ResultPanel
                video={result.video}
                result={result.result as { overall: string; videoType?: string; segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[] }}
                transcriptSource={result.transcriptSource}
              />
            </div>
            {/* 右：追问对话 */}
            <div className="flex flex-col rounded-[10px] border border-[#e5e6eb] bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:h-[calc(100vh-140px)]">
              <ChatPanel conversation={conversation} followUpLoading={followUpLoading} onExample={handleFollowUp} />
              <FollowUpInput onSubmit={handleFollowUp} isLoading={followUpLoading} />
            </div>
          </div>
        )}

        {/* AI 流式分析中 */}
        {streamingText && !result && (
          <div className="mt-8 w-full max-w-2xl rounded-[10px] border border-[#e5e6eb] bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="animate-pulse text-lg">🤖</span>
              <h3 className="text-sm font-medium text-[#1d2129]">AI 实时分析中...</h3>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg bg-[#f7f8fa] p-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[#4e5969] font-sans">
                {streamingText}
              </pre>
            </div>
          </div>
        )}
      </main>
      )}

      <Footer />
    </div>
  );
}
