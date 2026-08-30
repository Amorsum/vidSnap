export interface Turn {
  id: number;
  question: string;
  answer: string;
}

interface ChatPanelProps {
  conversation: Turn[];
  followUpLoading?: boolean;
  onExample?: (question: string) => void;
}

const EXAMPLES = [
  "这个视频主要讲了什么？",
  "有哪些关键结论？",
  "视频里提到的核心方法是什么？",
];

/** 渲染回答文本，高亮 [MM:SS] 时间戳引用（蓝色胶囊） */
function renderAnswer(text: string) {
  const parts = text.split(/(\[[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\])/g);
  return parts.map((part, i) => {
    if (/^\[[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\]$/.test(part)) {
      return (
        <span
          key={i}
          className="mx-0.5 rounded-md bg-[#e8f3ff] px-1 font-mono text-[11px] text-[#165dff]"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChatPanel({ conversation, followUpLoading, onExample }: ChatPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">💬</span>
        <h3 className="text-sm font-semibold text-[#1d2129]">追问对话</h3>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {/* 空状态 */}
        {conversation.length === 0 && !followUpLoading && (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <span className="text-3xl">💬</span>
            <p className="mt-3 text-sm text-[#86909c]">还没有追问</p>
            <p className="mt-1 text-xs text-[#c9cdd4]">针对视频细节提问，试试：</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => onExample?.(q)}
                  disabled={followUpLoading}
                  className="rounded-full border border-[#e5e6eb] bg-white px-3 py-1.5 text-xs text-[#4e5969] transition-colors hover:border-[#165dff] hover:text-[#165dff] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#e5e6eb] disabled:hover:text-[#4e5969]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {conversation.map((turn) => (
          <div key={turn.id} className="space-y-3">
            {/* 用户问题：右对齐蓝色气泡 */}
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-[10px] rounded-br-sm bg-[#165dff] px-3.5 py-2.5">
                <p className="text-sm text-white">{turn.question}</p>
              </div>
            </div>
            {/* AI 回答：左对齐灰气泡 */}
            {turn.answer && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-[10px] rounded-bl-sm bg-[#f2f3f5] px-3.5 py-2.5">
                  <p className="text-sm leading-relaxed text-[#1d2129]">{renderAnswer(turn.answer)}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* 正在输入 */}
        {followUpLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-[10px] rounded-bl-sm bg-[#f2f3f5] px-3.5 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#86909c]" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#86909c]" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#86909c]" style={{ animationDelay: "300ms" }} />
              <span className="ml-1 text-xs text-[#86909c]">正在输入...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
