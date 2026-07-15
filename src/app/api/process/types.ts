// ─── API 类型定义 ───

/** 支持的处理动作 */
export type ProcessAction = "summarize" | "extract" | "translate";

/** API 请求 */
export interface ProcessRequest {
  url: string;
  action: ProcessAction;
  /** 关键信息提取时使用：用户关注点 */
  query?: string;
  /** 翻译时使用：目标语言（默认中文） */
  targetLang?: string;
}

/** 视频基本信息 */
export interface VideoResponse {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

/** 总结结果 */
export interface SummaryResponse {
  overall: string;
  segments: {
    title: string;
    start: number;
    end: number;
    points: { time: string; text: string }[];
  }[];
}

/** API 成功响应 */
export interface ProcessSuccessResponse {
  success: true;
  video: VideoResponse;
  transcriptSource: "builtin" | "whisper";
  result: SummaryResponse | Record<string, unknown>;
}

/** API 错误响应 */
export interface ProcessErrorResponse {
  success: false;
  error: string;
}

/** 处理进度（用于 SSE / 轮询） */
export type ProgressStep = "downloading" | "transcribing" | "analyzing" | "done" | "error";

export interface ProgressUpdate {
  step: ProgressStep;
  message: string;
  percent?: number;
}
