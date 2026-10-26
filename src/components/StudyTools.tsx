"use client";

import { useState } from "react";
import { REVIEW_QUESTION, termQuestion } from "@/lib/study-tools";
import type { StudyTurn } from "@/lib/learning-types";

interface Props { disabled: boolean; onAsk: (question: string, purpose?: StudyTurn["purpose"]) => void }

export default function StudyTools({ disabled, onAsk }: Props) {
  const [term, setTerm] = useState("");
  const [error, setError] = useState("");
  const explain = () => {
    const question = termQuestion(term);
    if (!question) { setError("请输入 1—80 个字符的术语。"); return; }
    if (!disabled) { setError(""); onAsk(question, "term"); }
  };
  return <details className="study-panel mb-4">
    <summary className="min-h-11 cursor-pointer font-semibold">学习辅助 · 术语解释与复习题</summary>
    <p className="mt-2 text-sm leading-6 text-muted">依据当前视频回答，结果保存到问答中。复习题先展示题目，参考答案由你选择查看；在线数据失效后需重新分析。</p>
    <div className="mt-4 flex flex-wrap items-end gap-2">
      <label className="min-w-0 basis-full text-sm font-medium sm:flex-1 sm:basis-0" htmlFor="study-term">想理解的术语<input id="study-term" className="study-input mt-2" placeholder="例如：检索增强生成" value={term} maxLength={80} onChange={e => { setTerm(e.target.value); setError(""); }} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); explain(); } }} aria-describedby={error ? "study-term-error" : undefined} /></label>
      <button type="button" className="study-button" disabled={disabled || !term.trim()} onClick={explain}>解释术语</button>
      <button type="button" className="study-button" disabled={disabled} onClick={() => onAsk(REVIEW_QUESTION, "review")}>生成复习题</button>
    </div>
    {error && <p id="study-term-error" role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </details>;
}
