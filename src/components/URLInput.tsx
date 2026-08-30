"use client";

import { extractUrl } from "@/lib/url-utils";
import ComposerInput from "./ComposerInput";

interface URLInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export default function URLInput({ onSubmit, isLoading }: URLInputProps) {
  return (
    <ComposerInput
      onSubmit={onSubmit}
      isLoading={isLoading}
      placeholder="粘贴 YouTube / 抖音视频链接..."
      submitLabel={isLoading ? "处理中..." : "开始"}
      transformValue={extractUrl}
      leadingIcon={<span className="text-[#86909c]">🔗</span>}
      containerClassName="w-full max-w-2xl"
      inputClassName="py-3"
      buttonClassName="px-5 py-2.5 font-medium"
      hint={(raw) => {
        // 实时提取：从粘贴的混杂文本中识别出 URL（如抖音分享文案）
        const trimmed = raw.trim();
        const extracted = trimmed ? extractUrl(raw) : "";
        const showExtracted = extracted !== trimmed && extracted !== raw;
        return showExtracted ? (
          <div className="mt-2 rounded-lg border border-[#e5e6eb] bg-white px-3 py-2 text-xs text-[#165dff]">
            🔍 已自动识别链接：<span className="font-mono">{extracted}</span>
          </div>
        ) : null;
      }}
    />
  );
}
