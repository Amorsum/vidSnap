import { memo, type ReactNode } from "react";

export interface Turn {
  id: number;
  question: string;
  answer: string;
  /** Agent 工具调用轨迹（追问 Agent 化后由服务端返回） */
  toolsUsed?: string[];
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

// 行内元素：时间戳引用 [MM:SS]（蓝色胶囊）| **加粗** | `行内代码`
const INLINE_PATTERN = /(\[[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\])|(\*\*[^*]+\*\*)|(`[^`]+`)/g;

/** 渲染行内元素（时间戳胶囊 + 加粗 + 行内代码），split 带捕获组单遍解析 */
function renderInline(text: string) {
  return text.split(INLINE_PATTERN).map((part, i) => {
    if (!part) return null;
    if (/^\[[0-9]/.test(part)) {
      return (
        <span
          key={i}
          className="mx-0.5 rounded-md bg-[#e8f3ff] px-1 font-mono text-[11px] text-[#165dff]"
        >
          {part}
        </span>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-[#e5e6eb] px-1 font-mono text-[12px] text-[#1d2129]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** 轻量 Markdown 渲染：分隔线 / 无序列表 / 有序列表 / 标题 / 段落（零依赖，覆盖模型常见输出形态） */
function renderAnswer(text: string) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (listItems.length > 0) {
      const items = listItems;
      blocks.push(
        listType === "ol" ? (
          <ol key={blocks.length} className="list-decimal space-y-1 pl-4">
            {items}
          </ol>
        ) : (
          <ul key={blocks.length} className="space-y-1">
            {items}
          </ul>
        )
      );
      listItems = [];
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    // 分隔线
    if (/^-{3,}$/.test(trimmed)) {
      flushList();
      blocks.push(<hr key={blocks.length} className="my-2 border-[#e5e6eb]" />);
      continue;
    }
    // 标题
    const headMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (headMatch) {
      flushList();
      blocks.push(
        <p key={blocks.length} className="font-semibold text-[#1d2129]">
          {renderInline(headMatch[1])}
        </p>
      );
      continue;
    }
    // 无序列表
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(
        <li key={listItems.length} className="flex items-start gap-2">
          <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-[#86909c]" />
          <span>{renderInline(ulMatch[1])}</span>
        </li>
      );
      continue;
    }
    // 有序列表
    const olMatch = trimmed.match(/^\d+[.、]\s*(.+)$/);
    if (olMatch) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(
        <li key={listItems.length}>
          <span>{renderInline(olMatch[1])}</span>
        </li>
      );
      continue;
    }
    // 段落
    flushList();
    blocks.push(
      <p key={blocks.length}>{renderInline(trimmed)}</p>
    );
  }
  flushList();

  return <div className="space-y-1.5">{blocks}</div>;
}

interface TurnItemProps {
  turn: Turn;
}

// memo：追问 loading 等父级状态变化时，未更新的历史问答不重渲染（含正则拆分）
const TurnItem = memo(function TurnItem({ turn }: TurnItemProps) {
  return (
    <div className="space-y-3">
      {/* 用户问题：右对齐蓝色气泡 */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[10px] rounded-br-sm bg-[#165dff] px-3.5 py-2.5">
          <p className="text-sm text-white">{turn.question}</p>
        </div>
      </div>
      {/* AI 回答：左对齐灰气泡（Markdown 渲染） */}
      {turn.answer && (
        <div className="flex justify-start">
          <div className="max-w-[90%] rounded-[10px] rounded-bl-sm bg-[#f2f3f5] px-3.5 py-2.5">
            {turn.toolsUsed && turn.toolsUsed.length > 0 && (
              <p className="mb-1 font-mono text-[10px] text-[#86909c]">
                🔧 {turn.toolsUsed.join(" → ")}
              </p>
            )}
            <div className="text-sm leading-relaxed text-[#1d2129]">{renderAnswer(turn.answer)}</div>
          </div>
        </div>
      )}
    </div>
  );
});

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
          <TurnItem key={turn.id} turn={turn} />
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
