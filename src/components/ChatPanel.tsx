import { memo, type ReactNode } from "react";
import Icon from "./Icon";

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
          className="mx-0.5 rounded-md bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand"
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
        <code key={i} className="rounded bg-surface-soft px-1 font-mono text-[12px] text-ink">
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
      blocks.push(<hr key={blocks.length} className="my-2 border-line" />);
      continue;
    }
    // 标题
    const headMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (headMatch) {
      flushList();
      blocks.push(
        <p key={blocks.length} className="font-semibold text-ink">
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
          <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-brand/60" />
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
    <div className="space-y-3 animate-rise-in">
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 shadow-[0_6px_16px_rgba(99,91,255,.16)]">
          <p className="text-sm leading-6 text-white">{turn.question}</p>
        </div>
      </div>
      {turn.answer && (
        <div className="flex justify-start">
          <div className="max-w-[94%] rounded-2xl rounded-bl-md border border-line/70 bg-surface-soft/70 px-3.5 py-3">
            {turn.toolsUsed && turn.toolsUsed.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 text-[10px] text-faint">
                <Icon name="search" size={11} /> <span className="font-mono">{turn.toolsUsed.join(" → ")}</span>
              </div>
            )}
            <div className="text-sm leading-6 text-[#36384c]">{renderAnswer(turn.answer)}</div>
          </div>
        </div>
      )}
    </div>
  );
});

export default function ChatPanel({ conversation, followUpLoading, onExample }: ChatPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3 border-b border-line/80 pb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon name="message" size={17} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-ink">视频 Agent</h2>
          <p className="mt-0.5 text-[10px] text-muted">询问细节、观点或特定时刻</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-[#eef9f5] px-2 py-1 text-[9px] font-semibold text-[#2c8f73]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#48bd9a]" /> 已就绪
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
        {conversation.length === 0 && !followUpLoading && (
          <div className="flex h-full min-h-80 flex-col items-center justify-center py-8 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand-soft to-[#f6f5ff] text-brand">
              <Icon name="wand" size={25} />
              <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#24263c] text-white"><Icon name="sparkles" size={11} /></span>
            </div>
            <p className="mt-5 text-sm font-semibold text-ink">还想知道什么？</p>
            <p className="mt-1.5 max-w-56 text-xs leading-5 text-muted">Agent 已阅读完整字幕和关键画面，可以继续深挖视频细节。</p>
            <div className="mt-5 flex w-full flex-col gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => onExample?.(q)}
                  disabled={followUpLoading}
                  className="group flex w-full items-center justify-between rounded-xl border border-line bg-white px-3.5 py-2.5 text-left text-xs text-muted transition-all hover:border-brand/25 hover:bg-brand-soft/30 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {q}
                  <Icon name="chevron-right" size={13} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>
              ))}
            </div>
          </div>
        )}

        {conversation.map((turn) => (
          <TurnItem key={turn.id} turn={turn} />
        ))}

        {followUpLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line/70 bg-surface-soft px-3.5 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: "300ms" }} />
              <span className="ml-1 text-xs text-muted">Agent 正在检索视频...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
