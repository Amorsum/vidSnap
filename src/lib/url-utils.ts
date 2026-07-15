// 支持 YouTube 和抖音的视频链接
const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const DOUYIN_REGEX = /douyin\.com/;

const SUPPORTED_URL_REGEX =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})|(?:douyin\.com\/(?:video\/|user\/)|v\.douyin\.com\/)/;

/** 从 URL 中提取域名内第一个完整 URL（http/https） */
const URL_EXTRACT_REGEX = /https?:\/\/[^\s]+/;

export type Platform = "youtube" | "douyin";

export function detectPlatform(url: string): Platform | null {
  if (YOUTUBE_REGEX.test(url)) return "youtube";
  if (DOUYIN_REGEX.test(url)) return "douyin";
  return null;
}

export function isValidUrl(url: string): boolean {
  return SUPPORTED_URL_REGEX.test(url);
}

/**
 * 从粘贴的文本中提取视频链接
 * 处理抖音分享文案中的混杂文本，如：
 * "3.51 复制打开抖音，看看【作者】... https://v.douyin.com/xxx/ y@g.Ok 12/28 XzT:/"
 * → 提取出 "https://v.douyin.com/xxx/"
 */
export function extractUrl(text: string): string {
  const trimmed = text.trim();
  // 如果本身就是纯 URL，直接返回
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }
  // 从混杂文本中提取第一个 URL
  const match = trimmed.match(URL_EXTRACT_REGEX);
  return match ? match[0] : trimmed;
}