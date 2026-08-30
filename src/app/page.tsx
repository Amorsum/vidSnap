"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import URLInput from "@/components/URLInput";
import ProcessingStatus from "@/components/ProcessingStatus";
import ResultPanel from "@/components/ResultPanel";
import ChatPanel from "@/components/ChatPanel";
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

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<ProgressStep>();
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [streamingText, setStreamingText] = useState<string>("");

  const [conversation, setConversation] = useState<{ question: string; answer: string }[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const handleSubmit = useCallback(async (url: string) => {
    setIsLoading(true);
    setErrorMessage(undefined);
    setResult(null);
    setStreamingText("");
    setProgressStep("downloading");
    setProgressPercent(0);
    setConversation([]);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, action: "summarize" }),
      });

      if (!response.ok) {
        // 非流式错误（400 等）
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
  }, []);

  const handleFollowUp = useCallback(async (question: string) => {
    if (!result) return;
    setFollowUpLoading(true);
    // 立即显示用户的问题（像微信发送消息），answer 先留空
    setConversation((prev) => [...prev, { question, answer: "" }]);

    const updateLast = (answer: string) => {
      setConversation((prev) => {
        const next = [...prev];
        next[next.length - 1] = { question, answer };
        return next;
      });
    };

    try {
      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: result.video.id, question }),
      });
      const data = await response.json();
      if (data.success) {
        updateLast(data.answer);
      } else {
        updateLast(data.error || "追问失败");
      }
    } catch {
      updateLast("网络请求失败，请稍后重试");
    } finally {
      setFollowUpLoading(false);
    }
  }, [result]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

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

      <Footer />
    </div>
  );
}
