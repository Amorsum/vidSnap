/**
 * 通用 LLM 服务层：支持 DeepSeek / Claude
 * 通过环境变量 LLM_PROVIDER 切换，默认 deepseek
 */
import { sseLines } from "./sse";

export type LLMProvider = "deepseek" | "claude";
export type SummarizeMode = "summary" | "keypoints" | "translate";

/** LLM 调用的 token 用量 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 命中的 prompt 缓存 token 数（DeepSeek 缓存命中更便宜） */
  cacheHitTokens: number;
}

interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  apiUrl: string;
  model: string;
}

const PROVIDER_CONFIGS: Record<LLMProvider, Omit<LLMConfig, "apiKey">> = {
  deepseek: {
    provider: "deepseek",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
  claude: {
    provider: "claude",
    apiUrl: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
  },
};

const SYSTEM_PROMPTS: Record<SummarizeMode, string> = {
  summary: `你是一个专业的视频内容分析助手。用户会给你一段视频字幕文本，请你：

1. 先判断视频类型（教程/新闻/评测/娱乐/其他）
2. 按视频结构分段，每段给出时间戳和标题
3. 用一句话总结整个视频的核心内容
4. 列出每段的关键要点

输出格式（Markdown）：

## 视频类型
[类型]

## 视频分段
- **00:00 - MM:SS** 段标题：要点描述

## 一句话总结
[一句话]

## 详细要点
- [时间戳] 要点描述`,

  keypoints: `你是一个专业的视频信息提取助手。用户会给你一段视频字幕文本和一个关注点，请你：

1. 提取与关注点相关的所有关键信息
2. 每条信息精确标注时间戳（秒）
3. 按重要性排序

输出格式（JSON）：
{
  "type": "视频类型",
  "focus": "用户关注点",
  "keypoints": [
    { "timestamp": 秒数, "text": "关键信息" }
  ]
}`,

  translate: `你是一个专业的视频翻译助手。用户会给你一段外语视频字幕文本，请你：

1. 理解视频内容后，用中文重新表达
2. 保留原文的语气和风格
3. 提供完整的翻译版本

输出格式（Markdown）：

## 中文翻译
[完整中文翻译，保留分段和时间戳]`,
};

function getConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || "deepseek") as LLMProvider;
  const apiKeyEnv =
    provider === "deepseek"
      ? process.env.DEEPSEEK_API_KEY
      : process.env.CLAUDE_API_KEY;

  if (!apiKeyEnv) {
    const envVar = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "CLAUDE_API_KEY";
    throw new Error(`未设置 ${envVar} 环境变量`);
  }

  return {
    ...PROVIDER_CONFIGS[provider],
    apiKey: apiKeyEnv,
  };
}

/**
 * 统一的 LLM 调用入口（使用内置 prompt 模板，非流式，供旧版 summarize 路由使用）
 */
export async function callLLM(
  transcript: string,
  mode: SummarizeMode
): Promise<{ result: string; provider: LLMProvider }> {
  const config = getConfig();
  const result = await callLLMWithPrompt(SYSTEM_PROMPTS[mode], transcript, { maxTokens: 4096 });
  return { result, provider: config.provider };
}

/**
 * 底层调用：使用自定义 system prompt 和 user message
 * 供 process/followup 路由等需要自定义 prompt 的模块使用
 */
export async function callLLMWithPrompt(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; jsonMode?: boolean; onUsage?: (usage: TokenUsage) => void }
): Promise<string> {
  const config = getConfig();
  const maxTokens = options?.maxTokens || 4096;

  if (config.provider === "deepseek") {
    const body = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      ...(options?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    if (options?.onUsage && data.usage) {
      options.onUsage({
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        cacheHitTokens: data.usage.prompt_cache_hit_tokens || 0,
      });
    }
    return data.choices?.[0]?.message?.content || "";
  }

  // Claude
  const body = {
    model: config.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ─── 流式调用（仅 DeepSeek） ───

/**
 * 底层流式调用：返回 AsyncGenerator，逐段 yield 文本内容
 */
export async function* callLLMStreaming(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; jsonMode?: boolean; onUsage?: (usage: TokenUsage) => void }
): AsyncGenerator<string> {
  const config = getConfig();
  const maxTokens = options?.maxTokens || 4096;

  if (config.provider !== "deepseek") {
    throw new Error("流式输出仅支持 DeepSeek");
  }

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
    stream: true,
    // JSON mode：强制模型输出合法 JSON（OpenAI 兼容）
    ...(options?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    // 需要 token 用量时，让流式响应在末尾返回 usage
    ...(options?.onUsage ? { stream_options: { include_usage: true } } : {}),
  };

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取流式响应");

  let lastUsage: TokenUsage | null = null;

  for await (const line of sseLines(reader)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) continue;
    const data = trimmed.slice(6);
    if (data === "[DONE]") {
      if (lastUsage && options?.onUsage) options.onUsage(lastUsage);
      return;
    }

    try {
      const parsed = JSON.parse(data);
      // 最后一个 chunk 可能只带 usage（无 content）
      if (parsed.usage) {
        lastUsage = {
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
          cacheHitTokens: parsed.usage.prompt_cache_hit_tokens || 0,
        };
      }
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) yield content;
    } catch {
      // 跳过无法解析的行
    }
  }

  // 流意外结束（未收到 [DONE]）时也回调
  if (lastUsage && options?.onUsage) options.onUsage(lastUsage);
}

// ─── Tool-calling 循环（Agentic 调用） ───

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema（DeepSeek: parameters；Claude: input_schema） */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON 字符串 */
  arguments: string;
}

export interface ToolLoopResult {
  text: string;
  toolsUsed: string[];
  usage: TokenUsage | null;
}

interface ToolLoopOptions {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools: ToolDefinition[];
  executeTool: (call: ToolCall) => Promise<string>;
  /** 工具执行轮数上限（默认 3），超限后强制直接回答 */
  maxToolRounds?: number;
  maxTokens?: number;
  onUsage?: (usage: TokenUsage) => void;
}

const FORCE_ANSWER_MESSAGE =
  "请基于已检索到的信息直接回答用户的问题，不要再调用任何工具。直接输出回答内容本身，禁止输出任何工具调用格式（如 invoke、tool_call、XML 标签等）。";

/** 清洗模型「模仿工具调用格式」输出的伪调用文本（DeepSeek 在工具消息堆里偶发） */
export function stripToolSyntax(text: string): string {
  return text
    .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
    .replace(/<tool_call[\s\S]*?<\/tool_call>/g, "")
    .replace(/<function_call[\s\S]*?<\/function_call>/g, "")
    .replace(/<｜tool▁call▁begin｜>[\s\S]*?<｜tool▁call▁end｜>/g, "")
    .trim();
}

/** 检测文本是否残留任何「工具调用格式」痕迹（覆盖 invoke/tool_call/function_call/特殊分隔符等变体） */
export function hasToolSyntax(text: string): boolean {
  return /invoke|tool_call|function_call|<parameter|▁call▁|▁name▁|tool_code|<｜tool/.test(text);
}

/**
 * 让模型自主决定是否/如何调用工具的多轮循环（追问 Agent 化）
 * 三重防护：轮数上限、相邻两轮调用完全相同即终止、单请求 60s 超时
 * 支持 DeepSeek（OpenAI function calling）与 Claude（tool_use/tool_result）两种协议
 */
export async function callLLMToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const config = getConfig();
  const maxTokens = opts.maxTokens || 1500;
  const maxToolRounds = opts.maxToolRounds ?? 3;
  const toolsUsed: string[] = [];

  const accumulate = (target: TokenUsage | null, usage: TokenUsage): TokenUsage => {
    if (!target) return { ...usage };
    target.promptTokens += usage.promptTokens;
    target.completionTokens += usage.completionTokens;
    target.totalTokens += usage.totalTokens;
    target.cacheHitTokens += usage.cacheHitTokens;
    return target;
  };
  let totalUsage: TokenUsage | null = null;

  const conversation: Array<Record<string, unknown>> = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 已出现过的工具调用签名集合：新一轮调用若全部命中历史签名（含交替循环），立即强制直接回答
  const seenSignatures = new Set<string>();
  // 工具名计数：同一工具最多使用 2 次（换参数的反复重试是模型打转的信号）
  const toolNameCounts = new Map<string, number>();
  const maxTotalToolCalls = 4; // 总工具调用硬上限（并行调用也会突破轮数限制，必须全局封顶）
  let rounds = 0;
  let finalText = "";

  /** 本轮调用是否属于「打转」（重复签名 / 同名超次 / 总次数超限）→ 强制直接回答 */
  const isThrash = (newCalls: { name: string; signature: string }[]): boolean => {
    if (newCalls.every((c) => seenSignatures.has(c.signature))) return true;
    if (newCalls.every((c) => (toolNameCounts.get(c.name) ?? 0) >= 2)) return true;
    if (toolsUsed.length + newCalls.length > maxTotalToolCalls) return true;
    return false;
  };
  const recordCalls = (newCalls: { name: string; signature: string }[]): void => {
    for (const c of newCalls) {
      seenSignatures.add(c.signature);
      toolNameCounts.set(c.name, (toolNameCounts.get(c.name) ?? 0) + 1);
    }
  };

  while (true) {
    if (config.provider === "deepseek") {
      // OpenAI 兼容 function calling
      const body: Record<string, unknown> = {
        model: config.model,
        messages: conversation,
        max_tokens: maxTokens,
        temperature: 0.3,
        ...(rounds < maxToolRounds
          ? {
              tools: opts.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
              tool_choice: "auto",
            }
          : {}),
      };

      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (data.usage) {
        totalUsage = accumulate(totalUsage, {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
          cacheHitTokens: data.usage.prompt_cache_hit_tokens || 0,
        });
      }

      const message = data.choices?.[0]?.message;
      const content: string = message?.content || "";
      const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc: {
        id: string;
        function?: { name?: string; arguments?: string };
      }) => ({
        id: tc.id,
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "{}",
      }));

      if (toolCalls.length === 0) {
        finalText = content || finalText;
        break;
      }
      if (rounds >= maxToolRounds) {
        // 轮数超限：强制不带 tools 的最后一轮直接回答
        conversation.push({ role: "user", content: FORCE_ANSWER_MESSAGE });
        rounds = maxToolRounds + 1;
        continue;
      }
      const newCalls = toolCalls.map((c) => ({
        name: c.name,
        signature: `${c.name}:${c.arguments}`,
      }));
      if (isThrash(newCalls)) {
        // 重复/交替/同名超次/总次数超限：强制直接回答
        conversation.push({ role: "user", content: FORCE_ANSWER_MESSAGE });
        rounds = maxToolRounds + 1;
        continue;
      }
      recordCalls(newCalls);

      // 执行工具并回填结果
      conversation.push({
        role: "assistant",
        content: content || null,
        tool_calls: message.tool_calls,
      });
      for (const call of toolCalls) {
        toolsUsed.push(call.name);
        let resultText: string;
        try {
          resultText = await opts.executeTool(call);
        } catch (err) {
          resultText = `工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
        }
        conversation.push({ role: "tool", tool_call_id: call.id, content: resultText });
      }
      rounds++;
    } else {
      // Claude tool_use / tool_result 协议
      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: maxTokens,
        system: opts.systemPrompt,
        messages: conversation,
        ...(rounds < maxToolRounds
          ? {
              tools: opts.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
      };

      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      if (data.usage) {
        const inputTokens = data.usage.input_tokens || 0;
        const outputTokens = data.usage.output_tokens || 0;
        totalUsage = accumulate(totalUsage, {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
          cacheHitTokens: data.usage.cache_read_input_tokens || 0,
        });
      }

      const contentBlocks = data.content || [];
      const text = contentBlocks
        .filter((b: { type?: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text || "")
        .join("");
      const toolUses = contentBlocks.filter((b: { type?: string }) => b.type === "tool_use");

      if (toolUses.length === 0) {
        finalText = text || finalText;
        break;
      }
      if (rounds >= maxToolRounds) {
        conversation.push({ role: "user", content: FORCE_ANSWER_MESSAGE });
        rounds = maxToolRounds + 1;
        continue;
      }
      const newCalls = toolUses.map(
        (tu: { name?: string; input?: unknown }) => ({
          name: tu.name || "",
          signature: `${tu.name}:${JSON.stringify(tu.input)}`,
        })
      );
      if (isThrash(newCalls)) {
        conversation.push({ role: "user", content: FORCE_ANSWER_MESSAGE });
        rounds = maxToolRounds + 1;
        continue;
      }
      recordCalls(newCalls);

      conversation.push({ role: "assistant", content: contentBlocks });
      for (const tu of toolUses) {
        toolsUsed.push(tu.name);
        let resultText: string;
        try {
          resultText = await opts.executeTool({
            id: tu.id,
            name: tu.name,
            arguments: JSON.stringify(tu.input || {}),
          });
        } catch (err) {
          resultText = `工具执行失败: ${err instanceof Error ? err.message : String(err)}`;
        }
        conversation.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: tu.id, content: resultText }],
        });
      }
      rounds++;
    }
  }

  if (opts.onUsage && totalUsage) opts.onUsage(totalUsage);
  // 最终文本再清洗一遍伪工具调用格式，避免「invoke 乱码」直达用户；
  // 清洗后仍有任何工具格式痕迹（未覆盖的变体）→ 整段替换为兜底文案
  const cleaned = stripToolSyntax(finalText);
  const text = hasToolSyntax(cleaned)
    ? "抱歉，这个问题我没能很好地组织回答，请换个问法试试。"
    : cleaned;
  return { text, toolsUsed, usage: totalUsage };
}