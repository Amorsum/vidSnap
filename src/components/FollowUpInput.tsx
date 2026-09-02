"use client";

import ComposerInput from "./ComposerInput";
import Icon from "./Icon";

interface FollowUpInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
}

export default function FollowUpInput({ onSubmit, isLoading }: FollowUpInputProps) {
  return (
    <ComposerInput
      onSubmit={onSubmit}
      isLoading={isLoading}
      placeholder="向这段视频提问..."
      submitLabel={<Icon name="send" size={16} />}
      containerClassName="w-full"
      inputClassName="py-3 text-sm"
      buttonClassName="h-10 w-10 px-0"
      ariaLabel="追问视频内容"
    />
  );
}
