import Icon, { type IconName } from "./Icon";

/** 处理阶段（与 SSE progress 事件的 step 一致） */
export type ProgressStep = "downloading" | "transcribing" | "vision" | "analyzing" | "done" | "error";

interface ProcessingStatusProps {
  isLoading: boolean;
  step?: ProgressStep;
  progress?: number; // 0-100 动态百分比
  errorMessage?: string;
}

const steps = [
  { key: "downloading", shortLabel: "解析视频", icon: "film" },
  { key: "transcribing", shortLabel: "识别字幕", icon: "captions" },
  { key: "vision", shortLabel: "理解画面", icon: "image" },
  { key: "analyzing", shortLabel: "生成总结", icon: "sparkles" },
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
      <div className="surface-shadow flex w-full max-w-3xl items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5" role="alert">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">!</div>
        <div>
          <p className="text-sm font-semibold text-red-700">解析遇到问题</p>
          <p className="mt-1 text-sm leading-6 text-red-600">{errorMessage}</p>
        </div>
      </div>
    );
  }

  const currentStepIndex = step ? steps.findIndex((s) => s.key === step) : -1;
  const displayPercent = progress ?? 0;
  const displayLabel = step ? (stepLabels[step] || "正在处理...") : "正在处理...";

  return (
    <div className="surface-shadow w-full max-w-3xl rounded-2xl border border-line bg-white p-5 sm:p-6" aria-live="polite">
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Icon name="wand" size={21} />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-white bg-[#46c7a5]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">AI 正在阅读这段视频</p>
          <p className="mt-0.5 truncate text-xs text-muted">{displayLabel}</p>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-brand">{displayPercent}%</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="sr-only">{displayLabel}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-[#8b84ff] transition-all duration-500 ease-out"
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2">
        {steps.map((s, i) => {
          const isDone = step === "done";
          const isCompleted = i < currentStepIndex; // 已完成的步骤
          const isActive = i === currentStepIndex && !isDone; // 进行中的步骤
          return (
            <div key={s.key} className="relative flex min-w-0 flex-col items-center gap-2 text-center">
              <div
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-xl border transition-all ${
                  isCompleted || isDone
                    ? "border-brand bg-brand text-white"
                    : isActive
                      ? "border-brand/30 bg-brand-soft text-brand ring-4 ring-brand/10"
                      : "border-line bg-white text-faint"
                }`}
              >
                {isCompleted || isDone ? <Icon name="check" size={15} /> : <Icon name={s.icon as IconName} size={15} />}
              </div>
              <span
                className={`truncate text-[10px] transition-colors sm:text-xs ${
                  isCompleted || isActive || isDone ? "font-medium text-muted" : "text-faint"
                }`}
              >
                {s.shortLabel}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={`absolute left-[calc(50%+20px)] top-4 h-px w-[calc(100%-32px)] transition-colors ${
                    isCompleted || isDone ? "bg-brand/50" : "bg-line"
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
