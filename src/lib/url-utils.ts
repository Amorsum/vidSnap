export type Platform = "youtube" | "douyin";
export const UNSUPPORTED_PLATFORM_MESSAGE = "目前仅支持 YouTube 和抖音链接";
export const MAX_VIDEO_URL_LENGTH = 4096;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const DOUYIN_HOSTS = new Set(["douyin.com", "www.douyin.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export interface VideoUrl {
  platform: Platform;
  url: string;
  /** 短链接尚未解析时没有视频 ID。 */
  videoId?: string;
}

/** 校验真实协议、主机和路径，并移除无需传给下载器的分享/跳转参数。 */
export function parseVideoUrl(input: unknown): VideoUrl | null {
  if (typeof input !== "string" || input.length > MAX_VIDEO_URL_LENGTH) return null;
  const text = input.trim();
  // URL 解析器会忽略控制字符、转换反斜线；入口先拒绝这些歧义写法。
  if (!/^https?:\/\//i.test(text) || /[\s\\\u0000-\u001f\u007f]/u.test(text)) return null;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.port || text.split("/")[2].includes("@")) return null;

  const host = parsed.hostname;
  if (YOUTUBE_HOSTS.has(host) || host === "youtu.be") {
    let id: string | undefined;
    if (host === "youtu.be") {
      id = parsed.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    } else if (parsed.pathname === "/watch") {
      const ids = parsed.searchParams.getAll("v");
      if (ids.length === 1) id = ids[0];
    } else {
      id = parsed.pathname.match(/^\/(?:embed|v|shorts)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    }
    if (!id || !YOUTUBE_ID.test(id)) return null;
    return { platform: "youtube", videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
  }

  if (DOUYIN_HOSTS.has(host)) {
    const id = parsed.pathname.match(/^\/video\/(\d{1,32})\/?$/)?.[1];
    if (!id) return null;
    return { platform: "douyin", videoId: id, url: `https://www.douyin.com/video/${id}` };
  }
  if (host === "v.douyin.com") {
    const code = parsed.pathname.match(/^\/([A-Za-z0-9_-]{1,128})\/?$/)?.[1];
    if (!code) return null;
    return { platform: "douyin", url: `https://v.douyin.com/${code}/` };
  }
  return null;
}

export function detectPlatform(url: string): Platform | null {
  return parseVideoUrl(url)?.platform ?? null;
}

export function normalizeVideoUrl(url: string): string {
  const video = parseVideoUrl(url);
  if (!video) throw new Error(UNSUPPORTED_PLATFORM_MESSAGE);
  return video.url;
}

export function isValidUrl(url: string): boolean {
  return parseVideoUrl(url) !== null;
}

/** 分享文案只提取第一个 HTTP(S) URL；安全校验仍由 parseVideoUrl 执行。 */
export function extractUrl(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"“”]+/i);
  return match ? match[0].replace(/[，。！？；：、,;!?)）\]】」』'’]+$/u, "") : trimmed;
}
