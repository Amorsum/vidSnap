/**
 * 平台处理器：把「下载/提取」逻辑与主流程解耦，方便扩展新平台（B站 等）
 * 每个平台实现统一的 download() 接口，主流程无需关心平台差异。
 */
import { detectPlatform, UNSUPPORTED_PLATFORM_MESSAGE } from "./url-utils";
import type { Platform } from "./url-utils";
import type { VideoInfo, ProcessResult } from "./video-processor";
import { extractVideoInfo, downloadAudio, downloadLowResVideo, tryDownloadSubtitles } from "./video-processor";

// 与 ProcessResult 字段一致（info + 音频路径 + 可选字幕路径）
export type DownloadResult = ProcessResult;

export interface PlatformProcessor {
  /** 轻量提取视频元信息（不下载媒体），供缓存查询等使用 */
  getInfo(url: string): Promise<VideoInfo>;
  /** 下载字幕/音频（info 为 getInfo 的结果，避免重复解析） */
  download(url: string, info: VideoInfo): Promise<DownloadResult>;
  /** 下载低分辨率视频流（仅关键帧视觉理解阶段按需调用），失败抛错由调用方降级 */
  downloadVideo?(url: string, info: VideoInfo): Promise<string>;
  /** 转写策略：短视频（<180s）是否使用 tiny 模型（抖音短视频专用） */
  useTinyForShortVideos?: boolean;
}

// ─── YouTube：字幕优先，无字幕则下载音频 ───

const youtubeProcessor: PlatformProcessor = {
  getInfo: (url) => extractVideoInfo(url),
  download: async (url, info) => {
    // 字幕优先：命中字幕则跳过下载音频（省 10-60s）
    const sub = await tryDownloadSubtitles(url, info);
    if (sub.subtitlePath) {
      return { info: sub.info, audioPath: "", subtitlePath: sub.subtitlePath };
    }
    // 无字幕，下载音频
    const result = await downloadAudio(url, info);
    return { info: result.info, audioPath: result.audioPath, subtitlePath: null };
  },
  downloadVideo: (url, info) => downloadLowResVideo(url, info),
};

// ─── 抖音：Playwright 提取信息 + ffmpeg 下载 ───

// getInfo 阶段提取到的视频直链缓存（按 URL 记忆），供 download 阶段复用，避免二次 Playwright 解析
const douyinVideoUrlMemo = new Map<string, string>();

const douyinProcessor: PlatformProcessor = {
  useTinyForShortVideos: true,
  getInfo: async (url) => {
    const { extractDouyinInfo } = await import("./douyin-processor");
    const { info, videoUrl } = await extractDouyinInfo(url);
    douyinVideoUrlMemo.set(url, videoUrl);
    return info;
  },
  download: async (url, info) => {
    const { extractDouyinInfo, downloadDouyinVideoAndAudio } = await import("./douyin-processor");
    let videoUrl = douyinVideoUrlMemo.get(url);
    douyinVideoUrlMemo.delete(url);
    if (!videoUrl) {
      // 缓存未命中，或并发同 URL 已被消费：重新提取兜底
      const extracted = await extractDouyinInfo(url);
      videoUrl = extracted.videoUrl;
    }
    // 视觉理解启用时保留 mp4（供抽关键帧），否则沿用「用完即删」
    const { isVisionEnabled } = await import("./vision");
    const { audioPath, videoPath } = await downloadDouyinVideoAndAudio(videoUrl, info.id, isVisionEnabled());
    return { info, audioPath, subtitlePath: null, videoPath };
  },
};

// 按平台键控注册：新增平台时在 detectPlatform 与这里各加一行
const processors: Record<Platform, PlatformProcessor> = {
  youtube: youtubeProcessor,
  douyin: douyinProcessor,
};

/** 根据 URL 选择对应的平台处理器 */
export function getProcessor(url: string): PlatformProcessor {
  const platform = detectPlatform(url);
  const processor = platform ? processors[platform] : undefined;
  if (!processor) {
    throw new Error(UNSUPPORTED_PLATFORM_MESSAGE);
  }
  return processor;
}
