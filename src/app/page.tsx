"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import URLInput from "@/components/URLInput";
import ProcessingStatus from "@/components/ProcessingStatus";
import ResultPanel from "@/components/ResultPanel";
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

  const [followUpAnswer, setFollowUpAnswer] = useState<string>();
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const handleSubmit = useCallback(async (url: string) => {
    setIsLoading(true);
    setErrorMessage(undefined);
    setResult(null);
    setStreamingText("");
    setProgressStep("downloading");
    setProgressPercent(0);
    setFollowUpAnswer(undefined);

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
    setFollowUpAnswer(undefined);
    
    try {
      const response = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: result.video.id, question }),
      });
      const data = await response.json();
      if (data.success) {
        setFollowUpAnswer(data.answer);
      } else {
        setFollowUpAnswer(data.error || "追问失败");
      }
    } catch {
      setFollowUpAnswer("网络请求失败，请稍后重试");
    } finally {
      setFollowUpLoading(false);
    }
  }, [result]);

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f0f]">
      {/* 背景光效 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-48 -top-48 h-[500px] w-[500px] rounded-full bg-[#6c5ce7] opacity-[0.07] blur-[120px]" />
        <div className="absolute -bottom-48 -right-48 h-[500px] w-[500px] rounded-full bg-[#00cec9] opacity-[0.07] blur-[120px]" />
      </div>

      <Header />

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 py-16">
        {/* Hero 文案 */}
        <div className="mb-12 max-w-2xl text-center">
          <h1 className="mb-4 text-5xl font-bold tracking-tight text-white">
            <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">
              AI 视频总结
            </span>
          </h1>
          <p className="text-lg text-[#a0a0b0]">
            不用从头追到尾，粘贴链接知原委<br />支持 B站（bilibili）
          </p>
        </div>

        {/* 输入区域 */}
        <URLInput onSubmit={handleSubmit} isLoading={isLoading} />

        {/* 进度展示 */}
        <div className="mt-8">
          <ProcessingStatus
            isLoading={isLoading}
            step={progressStep}
            progress={progressPercent}
            errorMessage={errorMessage}
          />
        </div>

        {/* 结果展示 */}
        {result && (
          <div className="mt-8">
            <ResultPanel
              video={result.video}
              result={result.result as { overall: string; videoType?: string; segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[] }}
              transcriptSource={result.transcriptSource}
              followUpAnswer={followUpAnswer}
              followUpLoading={followUpLoading}
            />
          </div>
        )}

        {/* AI 流式分析中 */}
        {streamingText && !result && (
          <div className="mt-8 w-full max-w-2xl rounded-2xl border border-[#6c5ce7]/20 bg-[#6c5ce7]/5 p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="animate-pulse text-lg">🤖</span>
              <h3 className="text-sm font-medium text-white">AI 实时分析中...</h3>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-xl border border-white/5 bg-white/5 p-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[#a0a0b0] font-sans">
                {streamingText}
              </pre>
            </div>
          </div>
        )}

        {/* 追问输入 */}
        {result && (
          <div className="mt-8">
            <FollowUpInput onSubmit={handleFollowUp} isLoading={isLoading} />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}