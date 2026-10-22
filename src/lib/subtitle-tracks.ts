export interface SubtitleTrack { language: string; kind: "manual" | "automatic"; format: "vtt" | "srt"; url: string }
export interface SubtitleSelection { language: string; kind: "manual" | "automatic"; delivery: "direct" | "yt-dlp" }
const PREFERRED = ["zh-Hans", "zh-CN", "zh-TW", "zh", "en", "ja", "ko", "de", "fr", "es", "pt", "ru", "ar"];
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

/** 只保留至多一个人工轨道和一个自动轨道；显式带 tlang 的翻译轨道不作为原始字幕。 */
export function selectSubtitleTracks(data: unknown): SubtitleTrack[] {
  if (!record(data)) return [];
  const original = typeof data.language === "string" ? data.language.toLowerCase() : undefined;
  const selected: SubtitleTrack[] = [];
  for (const kind of ["manual", "automatic"] as const) {
    const inventory = kind === "manual" ? data.subtitles : data.automatic_captions;
    if (!record(inventory)) continue;
    const candidates: SubtitleTrack[] = [];
    for (const [language, formats] of Object.entries(inventory)) {
      if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(language) || language.length > 64 || !Array.isArray(formats)) continue;
      for (const format of formats) {
        if (!record(format) || !["vtt", "srt"].includes(String(format.ext)) || typeof format.url !== "string" || format.url.length > 4096
            || /[\s\\\u0000-\u001f\u007f]/.test(format.url)) continue;
        try {
          const url = new URL(format.url);
          if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.searchParams.has("tlang")) continue;
          // 连接、主机白名单和全量 DNS 校验仍由 Python 媒体边界执行。
          candidates.push({ language, kind, format: format.ext === "vtt" ? "vtt" : "srt", url: format.url });
        } catch { /* 格式不合法的可选轨道不应阻断音频转写。 */ }
      }
    }
    const rank = (track: SubtitleTrack) => {
      const language = track.language.toLowerCase().replace(/-orig$/, "");
      if (original && (language === original || language === original.split("-")[0])) return -2;
      if (kind === "automatic" && track.language.endsWith("-orig")) return -1;
      const preferred = PREFERRED.findIndex((item) => item.toLowerCase() === language);
      return preferred < 0 ? PREFERRED.length : preferred;
    };
    candidates.sort((left, right) => rank(left) - rank(right) || left.language.localeCompare(right.language)
      || Number(left.format !== "vtt") - Number(right.format !== "vtt"));
    if (candidates[0]) selected.push(candidates[0]);
  }
  return selected;
}

/** 请求内的短期交接，不按 URL 跨用户共享；签名地址不进入 VideoInfo 或结果缓存。 */
export class SubtitleTrackHandoff<T extends object> {
  private readonly entries = new Map<T, { url: string; expiresAt: number; tracks: SubtitleTrack[] }>();
  constructor(private readonly now = Date.now) {}

  remember(info: T, url: string, tracks: SubtitleTrack[]): void {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key);
    while (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(info, { url, expiresAt: this.now() + 120000, tracks: tracks.map((track) => ({ ...track })) });
  }

  take(info: T, url: string): SubtitleTrack[] | undefined {
    const entry = this.entries.get(info);
    this.entries.delete(info);
    return entry && entry.url === url && entry.expiresAt > this.now() ? entry.tracks : undefined;
  }
}
