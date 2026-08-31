/** 处理阶段（与 SSE progress 事件的 step 一致） */
export type ProgressStep = "downloading" | "transcribing" | "vision" | "analyzing" | "done" | "error";

interface ProcessingStatusProps {
  isLoading: boolean;
  step?: ProgressStep;
  progress?: number; // 0-100 动态百分比
  errorMessage?: string;
}

const steps = [
  { key: "downloading", shortLabel: "下载音频" },
  { key: "transcribing", shortLabel: "语音转写" },
  { key: "vision", shortLabel: "视觉理解" },
  { key: "analyzing", shortLabel: "AI 总结" },
] as const;

const stepLabels: Partial<Record<ProgressStep, string>> = {
  downloading: "正在下载视频音频...",
  transcribing: "正在识别语音字幕...",
  vision: "正在分析关键帧画面...",
  analyzing: "AI 正在理解视频内容...",
  done: "处理完成",
};

export default function ProcessingStatus({
  isLoading,
  step,
  progress,
  errorMessage,
}: ProcessingStatusProps) {
  if (!isLoading && !errorMessage) return null;

  if (errorMessage) {
    return (
      <div className="w-full max-w-2xl rounded-[10px] border border-red-200 bg-red-50 p-5">
        <p className="text-sm text-red-600">{errorMessage}</p>
      </div>
    );
  }

  const currentStepIndex = step ? steps.findIndex((s) => s.key === step) : -1;
  const displayPercent = progress ?? 0;
  const displayLabel = step ? (stepLabels[step] || "正在处理...") : "正在处理...";

  return (
    <div className="w-full max-w-2xl space-y-4 rounded-[10px] border border-[#e5e6eb] bg-white p-6 shadow-sm">
      {/* 进度条 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#1d2129]">{displayLabel}</span>
          <span className="text-xs font-mono text-[#165dff]">{displayPercent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5e6eb]">
          <div
            className="h-full rounded-full bg-[#165dff] transition-all duration-300 ease-out"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      </div>

      {/* 步骤指示器 */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => {
          const isDone = step === "done";
          const isCompleted = i < currentStepIndex; // 已完成的步骤
          const isActive = i === currentStepIndex && !isDone; // 进行中的步骤
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full transition-colors ${
                  isCompleted || isDone
                    ? "bg-[#165dff]"
                    : isActive
                      ? "bg-[#165dff] animate-pulse"
                      : "bg-[#e5e6eb]"
                }`}
              />
              <span
                className={`text-xs transition-colors ${
                  isCompleted || isActive || isDone ? "text-[#86909c]" : "text-[#c9cdd4]"
                }`}
              >
                {s.shortLabel}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={`mx-1 h-px w-4 transition-colors ${
                    isCompleted || isDone ? "bg-[#165dff]/50" : "bg-[#e5e6eb]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
