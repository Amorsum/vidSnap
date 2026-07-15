interface ProcessingStatusProps {
  isLoading: boolean;
  step?: "downloading" | "transcribing" | "analyzing" | "done" | "error";
  progress?: number; // 0-100 动态百分比
  errorMessage?: string;
}

const steps = [
  { key: "downloading", label: "正在下载视频音频...", shortLabel: "下载音频" },
  { key: "transcribing", label: "正在识别语音字幕...", shortLabel: "语音转写" },
  { key: "analyzing", label: "AI 正在理解视频内容...", shortLabel: "AI 总结" },
];

const stepLabels: Record<string, string> = {
  downloading: "正在下载视频音频...",
  transcribing: "正在识别语音字幕...",
  analyzing: "AI 正在理解视频内容...",
  done: "处理完成",
  cache_hit: "缓存命中，秒级返回...",
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
      <div className="w-full max-w-2xl rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
        <p className="text-sm text-red-400">{errorMessage}</p>
      </div>
    );
  }

  const currentStepIndex = step ? steps.findIndex((s) => s.key === step) : -1;
  const displayPercent = progress ?? 0;
  const displayLabel = step ? (stepLabels[step] || "正在处理...") : "正在处理...";

  return (
    <div className="w-full max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      {/* 进度条 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white">{displayLabel}</span>
          <span className="text-xs font-mono text-[#6c5ce7]">{displayPercent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] transition-all duration-300 ease-out"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      </div>

      {/* 步骤指示器 */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full transition-all duration-500 ${
                i < currentStepIndex
                  ? "bg-[#00cec9]"
                  : i === currentStepIndex
                    ? "bg-[#6c5ce7] animate-pulse"
                    : step === "done"
                      ? "bg-[#00cec9]"
                      : "bg-white/20"
              }`}
            />
            <span
              className={`text-xs transition-colors ${
                i <= currentStepIndex || step === "done" ? "text-[#a0a0b0]" : "text-white/30"
              }`}
            >
              {s.shortLabel}
            </span>
            {i < steps.length - 1 && (
              <div
                className={`mx-1 h-px w-4 transition-colors duration-500 ${
                  i < currentStepIndex || step === "done" ? "bg-[#00cec9]/50" : "bg-white/10"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}