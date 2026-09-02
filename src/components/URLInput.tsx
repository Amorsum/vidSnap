"use client";

import { extractUrl } from "@/lib/url-utils";
import ComposerInput from "./ComposerInput";
import Icon from "./Icon";

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
      submitLabel={isLoading ? "正在解析" : "开始解析"}
      transformValue={extractUrl}
      leadingIcon={<Icon name="link" size={19} className="shrink-0 text-brand" />}
      containerClassName="w-full max-w-3xl"
      inputClassName="py-3.5 text-sm sm:text-base"
      buttonClassName="min-h-11 px-4 sm:px-5"
      ariaLabel="视频链接"
      clearOnSubmit={false}
      hint={(raw) => {
        // 实时提取：从粘贴的混杂文本中识别出 URL（如抖音分享文案）
        const trimmed = raw.trim();
        const extracted = trimmed ? extractUrl(raw) : "";
        const showExtracted = extracted !== trimmed && extracted !== raw;
        return showExtracted ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-brand/15 bg-brand-soft/70 px-3 py-2 text-xs text-brand-strong">
            <Icon name="search" size={14} className="mt-0.5 shrink-0" />
            <span>已自动识别链接：<span className="break-all font-mono">{extracted}</span></span>
          </div>
        ) : null;
      }}
    />
  );
}
