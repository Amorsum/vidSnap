"use client";

import { useState } from "react";
import { extractUrl } from "@/lib/url-utils";

interface URLInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export default function URLInput({ onSubmit, isLoading }: URLInputProps) {
  const [url, setUrl] = useState("");

  const handleSubmit = () => {
    if (!url.trim() || isLoading) return;
    const cleanUrl = extractUrl(url);
    onSubmit(cleanUrl);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text");
    const cleanUrl = extractUrl(pasted);
    if (cleanUrl !== pasted) {
      e.preventDefault();
      setUrl(cleanUrl);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur">
        <div className="flex items-center gap-2 px-4">
          <span className="text-[#a0a0b0]">🔗</span>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="粘贴 B站视频链接..."
            disabled={isLoading}
            className="flex-1 bg-transparent py-3 text-white placeholder-[#666] outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!url.trim() || isLoading}
            className="rounded-xl bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? "处理中..." : "开始"}
          </button>
        </div>
      </div>
    </div>
  );
}
