// ─── 常量定义 ───

/** 支持的视频平台域名 */
export const SUPPORTED_DOMAINS = {
  youtube: [
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "m.youtube.com",
  ],
  // Week 3-4 扩展
  // douyin: ["douyin.com", "iesdouyin.com"],
} as const;

/** YouTube 链接正则 */
export const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** 处理动作 */
export const PROCESS_ACTIONS = ["summarize", "extract", "translate"] as const;

/** 错误消息 */
export const ERROR_MESSAGES = {
  URL_REQUIRED: "请提供视频链接",
  ACTION_REQUIRED: '请指定操作类型：summarize（总结）/ extract（关键提取）/ translate（翻译）',
  UNSUPPORTED_PLATFORM: "目前仅支持 YouTube 链接",
  ACTION_NOT_READY: (action: string) =>
    `"${action}" 功能即将上线，当前仅支持 "summarize"（总结）`,
  NO_TRANSCRIPT: "无法获取视频字幕，该视频可能没有语音内容",
  API_KEY_MISSING: "未配置 LLM API Key。请在 .env.local 中设置 DEEPSEEK_API_KEY 或 CLAUDE_API_KEY。",
  NETWORK_ERROR: "网络请求失败，请检查网络连接后重试",
  PROCESS_FAILED: "处理失败，请稍后重试",
} as const;
