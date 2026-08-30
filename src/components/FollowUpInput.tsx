"use client";

import ComposerInput from "./ComposerInput";

interface FollowUpInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
}

export default function FollowUpInput({ onSubmit, isLoading }: FollowUpInputProps) {
  return (
    <ComposerInput
      onSubmit={onSubmit}
      isLoading={isLoading}
      placeholder="继续追问这个视频..."
      submitLabel="发送"
      containerClassName="w-full"
      inputClassName="py-2.5 text-sm"
      buttonClassName="px-4 py-1.5"
    />
  );
}
