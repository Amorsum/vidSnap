"use client";

import { useState } from "react";
import { extractUrl } from "@/lib/url-utils";

interface URLInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export default function URLInput({ onSubmit, isLoading }: URLInputProps) {
  const [value, setValue] = useState("");

  // 实时提取：从粘贴的混杂文本中识别出 URL（如抖音分享文案）
  const extractedUrl = value.trim() ? extractUrl(value) : "";
  const showExtracted = extractedUrl !== value.trim() && extractedUrl !== value;

  const handleSubmit = () => {
    if (!value.trim() || isLoading) return;
    onSubmit(extractUrl(value));
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="rounded-[10px] border border-[#e5e6eb] bg-white p-2 shadow-sm transition-colors focus-within:border-[#165dff]">
        <div className="flex items-center gap-2 px-3">
          <span className="text-[#86909c]">🔗</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="粘贴 YouTube / 抖音视频链接..."
            disabled={isLoading}
            className="flex-1 bg-transparent py-3 text-[#1d2129] placeholder-[#c9cdd4] outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isLoading}
            className="rounded-lg bg-[#165dff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4080ff] disabled:cursor-not-allowed disabled:bg-[#94bfff]"
          >
            {isLoading ? "处理中..." : "开始"}
          </button>
        </div>
      </div>
      {showExtracted && (
        <div className="mt-2 rounded-lg border border-[#e5e6eb] bg-white px-3 py-2 text-xs text-[#165dff]">
          🔍 已自动识别链接：<span className="font-mono">{extractedUrl}</span>
        </div>
      )}
    </div>
  );
}
