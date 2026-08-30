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
    <div className="w-full">
      <div className="rounded-[10px] border border-[#e5e6eb] bg-white p-2 shadow-sm transition-colors focus-within:border-[#165dff]">
        <div className="flex items-center gap-2 px-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="继续追问这个视频..."
            disabled={isLoading}
            className="flex-1 bg-transparent py-2.5 text-sm text-[#1d2129] placeholder-[#c9cdd4] outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={!question.trim() || isLoading}
            className="rounded-lg bg-[#165dff] px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#4080ff] disabled:cursor-not-allowed disabled:bg-[#94bfff]"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
