"use client";

import { useState } from "react";
import { extractUrl } from "@/lib/url-utils";

interface URLInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export default function URLInput({ onSubmit, isLoading }: URLInputProps) {
  const [value, setValue] = useState("");

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
    </div>
  );
}