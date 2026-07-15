// B站视频链接
const BILIBILI_REGEX = /(?:bilibili\.com\/(?:video\/(?:BV[a-zA-Z0-9]{10}|av\d+)|bangumi\/play\/(?:ep|ss)\d+)|b23\.tv\/[a-zA-Z0-9]+)/;

const SUPPORTED_URL_REGEX = BILIBILI_REGEX;

/** 从 URL 中提取域名内第一个完整 URL（http/https） */
const URL_EXTRACT_REGEX = /https?:\/\/[^\s]+/;

export type Platform = "bilibili";

export function detectPlatform(url: string): Platform | null {
  if (BILIBILI_REGEX.test(url)) return "bilibili";
  return null;
}

export function isValidUrl(url: string): boolean {
  return SUPPORTED_URL_REGEX.test(url);
}

/**
 * 从粘贴的文本中提取视频链接
 */
export function extractUrl(text: string): string {
  const trimmed = text.trim();
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(URL_EXTRACT_REGEX);
  return match ? match[0] : trimmed;
}