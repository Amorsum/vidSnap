"use client";

import { useState } from "react";

interface FollowUpInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
}

export default function FollowUpInput({ onSubmit, isLoading }: FollowUpInputProps) {
  const [question, setQuestion] = useState("");

  const handleSubmit = () => {
    if (!question.trim() || isLoading) return;
    onSubmit(question.trim());
    setQuestion("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur">
        <div className="flex items-center gap-2 px-4">
          <span className="text-[#a0a0b0]">💬</span>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="继续追问这个视频..."
            disabled={isLoading}
            className="flex-1 bg-transparent py-3 text-sm text-white placeholder-[#666] outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!question.trim() || isLoading}
            className="rounded-xl border border-[#6c5ce7]/50 px-4 py-2 text-sm text-[#a29bfe] transition-all hover:bg-[#6c5ce7]/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
