import { parseVideoUrl } from "./url-utils";

export const PENDING_PROCESS_KEY = "vidsnap-pending-process";
const RECOVERY_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface PendingProcess {
  version: 1;
  url: string;
  startedAt: number;
  analysisId?: string;
}

/** 只记录当前标签页的恢复线索；不保存访问码、会话凭据或模型内容。 */
export function readPendingProcess(storage: Pick<Storage, "getItem" | "removeItem">, now = Date.now()): PendingProcess | null {
  try {
    const raw = storage.getItem(PENDING_PROCESS_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "version" in value && value.version === 1
      && "url" in value && typeof value.url === "string" && parseVideoUrl(value.url)
      && "startedAt" in value && typeof value.startedAt === "number" && Number.isFinite(value.startedAt)
      && value.startedAt > 0 && value.startedAt <= now && now - value.startedAt < RECOVERY_WINDOW_MS
      && (!("analysisId" in value) || (typeof value.analysisId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.analysisId)))) {
      return { version: 1, url: parseVideoUrl(value.url)!.url, startedAt: value.startedAt, ...("analysisId" in value ? { analysisId: String(value.analysisId) } : {}) };
    }
    storage.removeItem(PENDING_PROCESS_KEY);
  } catch { /* 存储不可用不影响当前页面继续处理。 */ }
  return null;
}

export function writePendingProcess(storage: Pick<Storage, "setItem" | "removeItem">, pending: PendingProcess | null): boolean {
  try {
    if (pending) storage.setItem(PENDING_PROCESS_KEY, JSON.stringify(pending));
    else storage.removeItem(PENDING_PROCESS_KEY);
    return true;
  } catch { return false; }
}
