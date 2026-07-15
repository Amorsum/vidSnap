/**
 * 通用 LLM 服务层：支持 DeepSeek / Claude
 * 通过环境变量 LLM_PROVIDER 切换，默认 deepseek
 */

export type LLMProvider = "deepseek" | "claude";
export type SummarizeMode = "summary" | "keypoints" | "translate";

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
 * 调用 DeepSeek（OpenAI 兼容格式）
 */
async function callDeepSeek(
  config: LLMConfig,
  systemPrompt: string,
  transcript: string
): Promise<string> {
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ],
    max_tokens: 4096,
    temperature: 0.3,
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
  return data.choices?.[0]?.message?.content || "";
}

/**
 * 调用 Claude（Anthropic 格式）
 */
async function callClaude(
  config: LLMConfig,
  systemPrompt: string,
  transcript: string
): Promise<string> {
  const body = {
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      { role: "user", content: transcript },
    ],
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

/**
 * 统一的 LLM 调用入口（使用内置 prompt 模板）
 */
export async function callLLM(
  transcript: string,
  mode: SummarizeMode
): Promise<{ result: string; provider: LLMProvider }> {
  const config = getConfig();
  const systemPrompt = SYSTEM_PROMPTS[mode];

  let result: string;
  if (config.provider === "deepseek") {
    result = await callDeepSeek(config, systemPrompt, transcript);
  } else {
    result = await callClaude(config, systemPrompt, transcript);
  }

  return { result, provider: config.provider };
}

/**
 * 底层调用：使用自定义 system prompt 和 user message
 * 供 ai-engine.ts 等需要自定义 prompt 的模块使用
 */
export async function callLLMWithPrompt(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number }
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
  options?: { maxTokens?: number }
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

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // 跳过无法解析的行
      }
    }
  }
}