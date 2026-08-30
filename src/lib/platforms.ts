/**
 * 平台处理器：把「下载/提取」逻辑与主流程解耦，方便扩展新平台（B站 等）
 * 每个平台实现统一的 download() 接口，主流程无需关心平台差异。
 */
import { detectPlatform } from "./url-utils";
import type { VideoInfo } from "./video-processor";
import { extractVideoInfo, downloadAudio, tryDownloadSubtitles } from "./video-processor";

export interface DownloadResult {
  info: VideoInfo;
  audioPath: string;
  subtitlePath: string | null;
}

export interface PlatformProcessor {
  /** 判断 URL 是否属于该平台 */
  matches(url: string): boolean;
  /** 提取视频信息 + 下载（字幕优先或音频），返回音频/字幕路径 */
  download(url: string): Promise<DownloadResult>;
}

// ─── YouTube：字幕优先，无字幕则下载音频 ───

const youtubeProcessor: PlatformProcessor = {
  matches: (url) => detectPlatform(url) === "youtube",
  download: async (url) => {
    // 字幕优先：命中字幕则跳过下载音频（省 10-60s）
    const sub = await tryDownloadSubtitles(url);
    if (sub.subtitlePath) {
      return { info: sub.info, audioPath: "", subtitlePath: sub.subtitlePath };
    }
    // 无字幕，下载音频
    const result = await downloadAudio(url);
    return { info: result.info, audioPath: result.audioPath, subtitlePath: null };
  },
};

// ─── 抖音：Playwright 提取信息 + ffmpeg 下载 ───

const douyinProcessor: PlatformProcessor = {
  matches: (url) => detectPlatform(url) === "douyin",
  download: async (url) => {
    const { extractDouyinInfo, downloadDouyinAudio } = await import("./douyin-processor");
    const { info, videoUrl } = await extractDouyinInfo(url);
    const audioPath = await downloadDouyinAudio(videoUrl, info.id);
    return { info, audioPath, subtitlePath: null };
  },
};

const processors: PlatformProcessor[] = [youtubeProcessor, douyinProcessor];

/** 根据 URL 选择对应的平台处理器 */
export function getProcessor(url: string): PlatformProcessor {
  const processor = processors.find((p) => p.matches(url));
  if (!processor) {
    throw new Error("暂不支持的平台，目前支持 YouTube 和抖音");
  }
  return processor;
}
