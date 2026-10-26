import type { AnalysisResult, StudyNote, SummaryResult, VisionMetadata } from "./learning-types";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function time(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

export function isSummaryResult(value: unknown): value is SummaryResult {
  return object(value) && typeof value.overall === "string" && !!value.overall.trim()
    && (value.videoType === undefined || typeof value.videoType === "string")
    && Array.isArray(value.segments) && value.segments.every(s => object(s) && typeof s.title === "string"
      && time(s.start) && time(s.end) && s.end >= s.start && Array.isArray(s.points)
      && s.points.every(p => object(p) && typeof p.time === "string" && typeof p.text === "string"));
}

export function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!object(value) || typeof value.analysisId !== "string" || !/^[a-f0-9-]{36}$/.test(value.analysisId)
    || !["youtube", "douyin"].includes(String(value.platform)) || typeof value.canonicalUrl !== "string"
    || !time(value.expiresAt) || !object(value.video) || !isSummaryResult(value.result)) return false;
  const v = value.video;
  if (typeof v.id !== "string" || typeof v.title !== "string" || !time(v.duration)
    || typeof v.thumbnail !== "string" || typeof v.uploader !== "string") return false;
  return ["builtin", "whisper"].includes(String(value.transcriptSource)) && typeof value.transcriptText === "string"
    && object(value.transcription) && ["builtin", "sensevoice", "whisper", "unknown"].includes(String(value.transcription.provider))
    && ["source", "estimated", "unknown"].includes(String(value.transcription.timing))
    && object(value.vision) && ["completed", "partial", "budget_exhausted", "failed", "disabled", "unavailable", "unknown"].includes(String(value.vision.outcome))
    && time(value.vision.describedFrames) && time(value.vision.totalFrames)
    && Array.isArray(value.transcriptSegments) && value.transcriptSegments.every(s => object(s) && time(s.start) && time(s.end)
      && s.end >= s.start && typeof s.text === "string")
    && Array.isArray(value.frames) && value.frames.every(f => object(f) && time(f.time) && typeof f.description === "string"
      && (f.src === undefined || typeof f.src === "string"));
}

export function formatTime(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, "0"));
  if (n >= 3600) parts.unshift(String(Math.floor(n / 3600)));
  return parts.join(":");
}

export function parseTime(text: string): number | null {
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(text)) return null;
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some(n => n >= 60)) return null;
  return parts.reduce((n, part) => n * 60 + part, 0);
}

/** 只从已验证的平台和 ID 构造外链，不信任本地存储中的任意 URL。 */
export function sourceUrl(analysis: Pick<AnalysisResult, "platform" | "video">, seconds = 0): string {
  return analysis.platform === "youtube"
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(analysis.video.id)}&t=${Math.max(0, Math.floor(seconds))}s`
    : `https://www.douyin.com/video/${encodeURIComponent(analysis.video.id)}`;
}

export function transcriptionLabel(analysis: Pick<AnalysisResult, "transcription">): string {
  return { builtin: "视频自带字幕", sensevoice: "SenseVoice 语音识别", whisper: "Whisper 语音识别", unknown: "语音识别来源未知" }[analysis.transcription.provider];
}

export function visionLabel(vision: VisionMetadata): string {
  const labels = { completed: "关键帧分析已完成", partial: "仅完成部分关键帧分析", budget_exhausted: "画面分析达到等待上限", failed: "画面分析失败，已使用文字总结", disabled: "本次未启用画面分析", unavailable: "本次无法获取画面", unknown: "画面分析状态未知" };
  return `${labels[vision.outcome]}${vision.totalFrames ? `（${vision.describedFrames}/${vision.totalFrames} 张）` : ""}`;
}

/** 只持久化文本快照，剥离帧签名及未知的运行时字段。 */
export function durableNote(note: StudyNote): StudyNote {
  const a = note.analysis;
  return { id: note.id, version: 1, analysis: {
    analysisId: a.analysisId, platform: a.platform, canonicalUrl: sourceUrl(a), expiresAt: a.expiresAt,
    framesExpireAt: a.framesExpireAt, video: { ...a.video }, transcriptSource: a.transcriptSource,
    transcription: { ...a.transcription }, vision: { ...a.vision }, transcriptText: a.transcriptText,
    transcriptSegments: a.transcriptSegments.map(s => ({ ...s })), result: a.result,
    frames: a.frames.map(f => ({ time: f.time, description: f.description })),
  }, turns: note.turns.filter(t => t.status === "success").map(t => ({ ...t })),
  personalNote: note.personalNote, createdAt: note.createdAt, updatedAt: note.updatedAt, lastViewedAt: note.lastViewedAt };
}

export function isStudyNote(value: unknown): value is StudyNote {
  return object(value) && value.version === 1 && typeof value.id === "string" && isAnalysisResult(value.analysis)
    && typeof value.personalNote === "string" && time(value.createdAt) && time(value.updatedAt) && time(value.lastViewedAt)
    && Array.isArray(value.turns) && value.turns.every(t => object(t) && typeof t.id === "number"
      && typeof t.question === "string" && typeof t.answer === "string" && t.status === "success"
      && (t.toolsUsed === undefined || (Array.isArray(t.toolsUsed) && t.toolsUsed.every(tool => typeof tool === "string"))));
}

function plain(text: string): string { return text.replace(/[\\`*_[\]<>#]/g, "\\$&").replace(/\r?\n/g, " "); }

export function exportMarkdown(note: StudyNote, includeTranscript: boolean): string {
  const a = note.analysis;
  const lines = [`# ${plain(a.video.title)}`, "", `原视频：${sourceUrl(a)}`, `作者：${plain(a.video.uploader || "未知作者")}`,
    `时长：${formatTime(a.video.duration)}`, `字幕来源：${transcriptionLabel(a)}`,
    `时间引用：${a.transcription.timing === "estimated" ? "估算时间，仅供定位参考" : a.transcription.timing === "source" ? "来自字幕或识别结果，可能存在偏差" : "精度未知"}`,
    `画面：${visionLabel(a.vision)}`, "", "## 一句话理解", "", plain(a.result.overall)];
  for (const segment of a.result.segments) {
    lines.push("", `## ${plain(segment.title)}（${formatTime(segment.start)}—${formatTime(segment.end)}）`, "");
    for (const p of segment.points) lines.push(`- [${plain(p.time)}] ${plain(p.text)}`);
  }
  if (a.frames.length) { lines.push("", "## 画面依据", ""); for (const f of a.frames) lines.push(`- [${formatTime(f.time)}] ${plain(f.description)}`); }
  lines.push("", "## 我的笔记", "", note.personalNote || "（尚未填写）", "", "## 历史问答", "");
  for (const turn of note.turns.filter(t => t.status === "success")) lines.push(`### ${plain(turn.question)}`, "", turn.answer, "");
  if (includeTranscript) { lines.push("", "## 字幕原文", ""); for (const s of a.transcriptSegments) lines.push(`[${formatTime(s.start)}] ${plain(s.text)}`, ""); }
  return lines.join("\n");
}
