import { durableNote, isStudyNote } from "./learning";
import type { StudyNote } from "./learning-types";
import { parseVideoUrl } from "./url-utils";

export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
export const BACKUP_MAX_NOTES = 500;
const FORMAT = "vidsnap-notebook";

/** 备份只携带可恢复的文字，不携带远程图片地址或在线访问凭据。 */
function backupNote(note: StudyNote): StudyNote {
  const copy = durableNote(note);
  copy.analysis.video.thumbnail = "";
  return copy;
}

export function exportNotebook(notes: StudyNote[], now = Date.now()): string {
  if (!notes.length) throw new Error("笔记库为空，先分析一个视频再备份。");
  if (notes.length > BACKUP_MAX_NOTES) throw new Error(`单次备份最多支持 ${BACKUP_MAX_NOTES} 篇笔记。`);
  const text = JSON.stringify({ format: FORMAT, version: 1, exportedAt: now, notes: notes.map(backupNote) }, null, 2);
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) throw new Error("备份超过 20 MiB，请先分别导出 Markdown 保存内容。");
  return text;
}

export function parseNotebookBackup(text: string): StudyNote[] {
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) throw new Error("备份文件不能超过 20 MiB。");
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("文件不是有效的 JSON 备份，请选择 VidSnap 导出的备份文件。"); }
  if (typeof value !== "object" || value === null || !("format" in value) || value.format !== FORMAT
    || !("version" in value) || value.version !== 1) throw new Error("不支持此备份格式或版本，请选择 VidSnap 笔记备份。");
  if (!("notes" in value) || !Array.isArray(value.notes) || !value.notes.length || value.notes.length > BACKUP_MAX_NOTES) {
    throw new Error(`备份应包含 1 至 ${BACKUP_MAX_NOTES} 篇笔记。`);
  }
  return value.notes.map((note: unknown, index: number) => {
    if (!isStudyNote(note) || !note.id.trim() || note.id.length > 200) throw new Error(`第 ${index + 1} 篇笔记内容不完整，整个文件未导入。`);
    const copy = backupNote(note);
    const source = parseVideoUrl(copy.analysis.canonicalUrl);
    if (!source || source.platform !== copy.analysis.platform) throw new Error(`第 ${index + 1} 篇笔记的视频标识无效，整个文件未导入。`);
    return copy;
  });
}

/** 排除查看时间、在线期限和本地 ID；重复导入冲突副本也不会再次复制。 */
function contentKey(note: StudyNote): string {
  const copy = backupNote(note);
  return JSON.stringify({ analysis: { ...copy.analysis, expiresAt: 0, framesExpireAt: undefined },
    personalNote: copy.personalNote, turns: copy.turns, excerpts: copy.excerpts });
}

export interface ImportPlan { added: StudyNote[]; skipped: number; copies: number }

export function planNotebookImport(existing: StudyNote[], incoming: StudyNote[], newId = () => crypto.randomUUID()): ImportPlan {
  const ids = new Set(existing.map(note => note.id));
  const contents = new Set(existing.map(contentKey));
  const added: StudyNote[] = [];
  let skipped = 0, copies = 0;
  for (const note of incoming) {
    const key = contentKey(note);
    if (contents.has(key)) { skipped++; continue; }
    const copy = backupNote(note);
    if (ids.has(copy.id)) {
      copy.id = newId();
      if (!copy.id || ids.has(copy.id)) throw new Error("无法生成笔记副本标识，请重试导入。");
      copies++;
    }
    ids.add(copy.id); contents.add(key); added.push(copy);
  }
  return { added, skipped, copies };
}
