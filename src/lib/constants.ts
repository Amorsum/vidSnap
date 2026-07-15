// ─── 常量定义 ───

/** 支持的视频平台域名 */
export const SUPPORTED_DOMAINS = {
  bilibili: [
    "bilibili.com",
    "b23.tv",
  ],
} as const;

/** B站视频链接正则 */
export const BILIBILI_REGEX =
  /(?:bilibili\.com\/(?:video\/(?:BV[a-zA-Z0-9]{10}|av\d+)|bangumi\/play\/(?:ep|ss)\d+)|b23\.tv\/[a-zA-Z0-9]+)/;

/** 处理动作 */
export const PROCESS_ACTIONS = ["summarize", "extract", "translate"] as const;

/** 错误消息 */
export const ERROR_MESSAGES = {
  URL_REQUIRED: "请提供视频链接",
  ACTION_REQUIRED: '请指定操作类型：summarize（总结）/ extract（关键提取）/ translate（翻译）',
  UNSUPPORTED_PLATFORM: "目前仅支持B站（bilibili）视频链接",
  ACTION_NOT_READY: (action: string) =>
    `"${action}" 功能即将上线，当前仅支持 "summarize"（总结）`,
  NO_TRANSCRIPT: "无法获取视频字幕，该视频可能没有语音内容",
  API_KEY_MISSING: "未配置 LLM API Key。请在 .env.local 中设置 DEEPSEEK_API_KEY 或 CLAUDE_API_KEY。",
  NETWORK_ERROR: "网络请求失败，请检查网络连接后重试",
  PROCESS_FAILED: "处理失败，请稍后重试",
} as const;