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
      <div className="rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur">
        <div className="flex items-center gap-2 px-4">
          <span className="text-[#a0a0b0]">🔗</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="粘贴 YouTube / 抖音视频链接..."
            disabled={isLoading}
            className="flex-1 bg-transparent py-3 text-white placeholder-[#666] outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isLoading}
            className="rounded-xl bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? "处理中..." : "开始"}
          </button>
        </div>
      </div>
      {showExtracted && (
        <div className="mt-2 rounded-lg border border-[#00cec9]/20 bg-[#00cec9]/5 px-3 py-2 text-xs text-[#00cec9]">
          🔍 已自动识别链接：<span className="font-mono">{extractedUrl}</span>
        </div>
      )}
    </div>
  );
}