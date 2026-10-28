export type Platform = "youtube" | "douyin" | "bilibili";
export const UNSUPPORTED_PLATFORM_MESSAGE = "请提供有效的 YouTube、Bilibili 或抖音视频链接";
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
  if (["bilibili.com", "www.bilibili.com", "m.bilibili.com"].includes(host)) {
    const id = parsed.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av[1-9]\d{0,19})\/?$/)?.[1];
    const pages = parsed.searchParams.getAll("p");
    if (!id || pages.length > 1 || (pages.length === 1 && !/^[1-9]\d{0,4}$/.test(pages[0]))) return null;
    const page = pages[0] ?? "1";
    return { platform: "bilibili", videoId: `${id}_p${page}`, url: `https://www.bilibili.com/video/${id}?p=${page}` };
  }
  if (host === "b23.tv") {
    const code = parsed.pathname.match(/^\/([A-Za-z0-9]{1,32})\/?$/)?.[1];
    if (!code) return null;
    return { platform: "bilibili", url: `https://b23.tv/${code}` };
  }
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

/** 仅用平台与服务端 ID 构造来源链接，B 站 ID 包含分 P，避免笔记与缓存串集。 */
export function videoSourceUrl(platform: Platform, id: string): string {
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (platform === "bilibili") {
    const match = id.match(/^(BV[A-Za-z0-9]{10}|av[1-9]\d{0,19})_p([1-9]\d{0,4})$/);
    if (!match) throw new Error("Bilibili 视频 ID 无效");
    return `https://www.bilibili.com/video/${match[1]}?p=${match[2]}`;
  }
  return `https://www.douyin.com/video/${encodeURIComponent(id)}`;
}

/** 分享文案只提取第一个 HTTP(S) URL；安全校验仍由 parseVideoUrl 执行。 */
export function extractUrl(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"“”，。！？；：、]+/i);
  return match ? match[0].replace(/[，。！？；：、,;!?)）\]】」』'’]+$/u, "") : trimmed;
}
