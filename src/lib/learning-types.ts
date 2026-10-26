/** 浏览器与服务端共用的学习结果契约；此模块不依赖媒体或文件系统。 */
export interface SummaryResult {
  overall: string;
  videoType?: string;
  segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[];
}

export interface TranscriptionMetadata {
  provider: "builtin" | "sensevoice" | "whisper" | "unknown";
  timing: "source" | "estimated" | "unknown";
}

export interface VisionMetadata {
  outcome: "completed" | "partial" | "budget_exhausted" | "failed" | "disabled" | "unavailable" | "unknown";
  describedFrames: number;
  totalFrames: number;
}

export interface AnalysisResult {
  analysisId: string;
  platform: "youtube" | "douyin";
  canonicalUrl: string;
  expiresAt: number;
  framesExpireAt?: number;
  video: { id: string; title: string; duration: number; thumbnail: string; uploader: string };
  transcriptSource: "builtin" | "whisper";
  transcription: TranscriptionMetadata;
  vision: VisionMetadata;
  transcriptText: string;
  transcriptSegments: { start: number; end: number; text: string }[];
  result: SummaryResult;
  frames: { time: number; description: string; src?: string }[];
}

export interface StudyTurn {
  id: number;
  question: string;
  answer: string;
  toolsUsed?: string[];
  status?: "pending" | "error" | "success";
  purpose?: "question" | "term" | "review" | "review_answers";
}

export interface ExcerptDraft {
  kind: "transcript" | "summary" | "answer";
  text: string;
  start?: number;
  end?: number;
}

export interface StudyExcerpt extends ExcerptDraft {
  id: string;
  createdAt: number;
}

export interface StudyNote {
  id: string;
  version: 1;
  analysis: AnalysisResult;
  turns: StudyTurn[];
  personalNote: string;
  /** 兼容已保存的 v1 笔记；缺省时视为空列表，不升级 IndexedDB 结构。 */
  excerpts?: StudyExcerpt[];
  createdAt: number;
  updatedAt: number;
  lastViewedAt: number;
}
