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
  submitLabel: string;
  /** 提交前对原始输入的处理（默认 trim；URLInput 用于从混杂文本提取链接） */
  transformValue?: (raw: string) => string;
  /** 输入框左侧图标 */
  leadingIcon?: React.ReactNode;
  containerClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  /** 输入框下方的附加提示（如 URL 识别结果），返回 null 时不渲染 */
  hint?: (raw: string) => React.ReactNode;
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
}: ComposerInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    if (!value.trim() || isLoading) return;
    onSubmit((transformValue ?? ((raw: string) => raw.trim()))(value));
    setValue("");
  };

  return (
    <div className={containerClassName}>
      <div className="rounded-[10px] border border-[#e5e6eb] bg-white p-2 shadow-sm transition-colors focus-within:border-[#165dff]">
        <div className="flex items-center gap-2 px-3">
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
            className={`flex-1 bg-transparent text-[#1d2129] placeholder-[#c9cdd4] outline-none disabled:opacity-50 ${inputClassName}`}
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isLoading}
            className={`rounded-lg bg-[#165dff] text-sm text-white transition-colors hover:bg-[#4080ff] disabled:cursor-not-allowed disabled:bg-[#94bfff] ${buttonClassName}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
      {hint?.(value)}
    </div>
  );
}
