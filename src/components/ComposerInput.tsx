"use client";

import { useState } from "react";

/**
 * 输入框 + 发送按钮的通用组合：URL 输入与追问输入共用
 * 内部管理输入状态与 Enter 提交，样式差异通过 className 传入
 */
interface ComposerInputProps {
  onSubmit: (value: string) => void;
  isLoading: boolean;
  placeholder: string;
  submitLabel: React.ReactNode;
  /** 提交前对原始输入的处理（默认 trim；URLInput 用于从混杂文本提取链接） */
  transformValue?: (raw: string) => string;
  /** 输入框左侧图标 */
  leadingIcon?: React.ReactNode;
  containerClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  /** 输入框下方的附加提示（如 URL 识别结果），返回 null 时不渲染 */
  hint?: (raw: string) => React.ReactNode;
  ariaLabel?: string;
  /** 提交后是否清空输入；视频链接需要保留，追问默认清空 */
  clearOnSubmit?: boolean;
}

export default function ComposerInput({
  onSubmit,
  isLoading,
  placeholder,
  submitLabel,
  transformValue,
  leadingIcon,
  containerClassName = "",
  inputClassName = "",
  buttonClassName = "",
  hint,
  ariaLabel,
  clearOnSubmit = true,
}: ComposerInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    if (!value.trim() || isLoading) return;
    const transformedValue = (transformValue ?? ((raw: string) => raw.trim()))(value);
    if (!transformedValue) return;
    onSubmit(transformedValue);
    if (clearOnSubmit) setValue("");
  };

  return (
    <div className={containerClassName}>
      <div className="surface-shadow rounded-2xl border border-line bg-white p-2 transition-all duration-300 focus-within:border-brand/50 focus-within:ring-4 focus-within:ring-brand/10">
        <div className="flex items-center gap-2 pl-3">
          {leadingIcon}
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder={placeholder}
            disabled={isLoading}
            aria-label={ariaLabel ?? placeholder}
            className={`min-w-0 flex-1 bg-transparent text-ink placeholder:text-faint outline-none disabled:opacity-50 ${inputClassName}`}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim() || isLoading}
            className={`brand-shadow flex shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-brand-strong disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-[#b8b4ea] disabled:shadow-none ${buttonClassName}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
      {hint?.(value)}
    </div>
  );
}
