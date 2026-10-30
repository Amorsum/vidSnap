/** N1 隔离存储原型；尚未接入现有 API。 */
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { Platform } from "../url-utils";

export class PersistenceUnavailableError extends Error {
  constructor() { super("持久化存储暂不可用，请稍后重试"); this.name = "PersistenceUnavailableError"; }
}

export function digestSessionToken(token: string): Buffer | null {
  return /^[a-f0-9]{64}$/.test(token) ? createHash("sha256").update(token, "utf8").digest() : null;
}

/** 只保存帧位置与描述；签名链接必须在读取时重新生成。 */
export interface PersistedFrame {
  frameId: number;
  time: number;
  description: string;
}

function validFrameManifest(value: unknown): value is PersistedFrame[] {
  if (!Array.isArray(value) || value.length > 99) return false;
  const ids = new Set<number>();
  return value.every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const frame = item as Record<string, unknown>;
    if (Object.keys(frame).some(key => !["frameId", "time", "description"].includes(key))
      || typeof frame.frameId !== "number" || !Number.isSafeInteger(frame.frameId) || frame.frameId < 1 || frame.frameId > 99
      || typeof frame.time !== "number" || !Number.isFinite(frame.time) || frame.time < 0
      || typeof frame.description !== "string" || frame.description.length > 10000 || ids.has(frame.frameId)) return false;
    ids.add(frame.frameId);
    return true;
  });
}

export interface CompletedAnalysis {
  id: string;
  ownerId: string;
  platform: Platform;
  videoId: string;
  revision: number;
  expiresAt: number;
  contentExpiresAt: number;
  framesExpireAt: number | null;
  result: unknown;
  evidence: unknown[];
  frameManifest: PersistedFrame[];
}

interface AnalysisRow {
  id: string; owner_id: string; platform: Platform; video_id: string; revision: string;
  expires_at: string; content_expires_at: string; frames_expire_at: string | null;
  result_payload: unknown; evidence: unknown[]; frame_manifest: unknown[];
}

/** 调用者负责验证结果/证据结构，不能把客户端备份作为可信输入。 */
export class PostgresAnalysisStore {
  private readonly pool: Pool;
  constructor(connectionString: string) { this.pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 3000 }); }

  async close(): Promise<void> { await this.pool.end(); }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch { throw new PersistenceUnavailableError(); }
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.guarded(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* 保留原错误，统一脱敏。 */ }
        throw error;
      } finally { client.release(); }
    });
  }

  async createSession(token: string, expiresAt: number): Promise<string> {
    const digest = digestSessionToken(token);
    if (!digest || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error("会话参数无效");
    const owner = randomUUID();
    await this.guarded(() => this.pool.query("INSERT INTO vidsnap_sessions(owner_id, token_hash, expires_at) VALUES ($1, $2, $3)", [owner, digest, expiresAt]));
    return owner;
  }

  async resolveSession(token: string, now = Date.now()): Promise<string | null> {
    const digest = digestSessionToken(token);
    if (!digest) return null;
    return this.guarded(async () => {
      const result = await this.pool.query<{ owner_id: string }>("SELECT owner_id FROM vidsnap_sessions WHERE token_hash = $1 AND expires_at > $2", [digest, now]);
      return result.rows[0]?.owner_id ?? null;
    });
  }

  async beginAnalysis(ownerId: string, platform: Platform, videoId: string, expiresAt: number, now = Date.now()): Promise<string | null> {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new Error("分析期限无效");
    const id = randomUUID();
    return this.guarded(async () => {
      const result = await this.pool.query<{ id: string }>(
        "INSERT INTO vidsnap_analyses(id, owner_id, platform, video_id, status, expires_at) SELECT $1, owner_id, $3, $4, 'running', $5 FROM vidsnap_sessions WHERE owner_id = $2 AND expires_at > $6 RETURNING id",
        [id, ownerId, platform, videoId, expiresAt, now]);
      return result.rows[0]?.id ?? null;
    });
  }

  async completeAnalysis(ownerId: string, id: string, expectedRevision: number, contentExpiresAt: number,
    result: Record<string, unknown>, evidence: unknown[], frameManifest: PersistedFrame[], framesExpireAt: number | null, now = Date.now()): Promise<boolean> {
    if (!validFrameManifest(frameManifest)) throw new Error("帧元数据无效");
    return this.guarded(async () => {
      const updated = await this.pool.query(
        "UPDATE vidsnap_analyses a SET status = 'completed', revision = a.revision + 1, content_expires_at = $4, result_payload = $5::jsonb, evidence = $6::jsonb, frame_manifest = $7::jsonb, frames_expire_at = $8 FROM vidsnap_sessions s WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'running' AND a.revision = $3 AND a.expires_at > $9 AND $4 > $9 AND s.owner_id = a.owner_id AND s.expires_at > $9 RETURNING a.id",
        [id, ownerId, expectedRevision, contentExpiresAt, JSON.stringify(result), JSON.stringify(evidence), JSON.stringify(frameManifest), framesExpireAt, now]);
      return updated.rowCount === 1;
    });
  }

  async getCompleted(ownerId: string, id: string, now = Date.now()): Promise<CompletedAnalysis | null> {
    return this.guarded(async () => {
      const found = await this.pool.query<AnalysisRow>("SELECT a.* FROM vidsnap_analyses a JOIN vidsnap_sessions s ON s.owner_id = a.owner_id WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'completed' AND a.content_expires_at > $3 AND a.expires_at > $3 AND s.expires_at > $3", [id, ownerId, now]);
      const row = found.rows[0];
      if (!row) return null;
      if (!validFrameManifest(row.frame_manifest)) throw new Error("帧元数据无效");
      return { id: row.id, ownerId: row.owner_id, platform: row.platform, videoId: row.video_id, revision: Number(row.revision),
        expiresAt: Number(row.expires_at), contentExpiresAt: Number(row.content_expires_at), framesExpireAt: row.frames_expire_at === null ? null : Number(row.frames_expire_at),
        result: row.result_payload, evidence: row.evidence, frameManifest: row.frame_manifest };
    });
  }

  async saveTurn(ownerId: string, id: string, question: string, answer: string, now = Date.now()): Promise<boolean> {
    return this.transaction(async client => {
      const analysis = await client.query("SELECT a.id FROM vidsnap_analyses a JOIN vidsnap_sessions s ON s.owner_id = a.owner_id WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'completed' AND a.content_expires_at > $3 AND a.expires_at > $3 AND s.expires_at > $3 FOR UPDATE OF a", [id, ownerId, now]);
      if (!analysis.rowCount) return false;
      await client.query("INSERT INTO vidsnap_conversation_turns(analysis_id, question, answer, created_at) VALUES ($1, $2, $3, $4)", [id, question, answer, now]);
      await client.query("DELETE FROM vidsnap_conversation_turns WHERE analysis_id = $1 AND id NOT IN (SELECT id FROM vidsnap_conversation_turns WHERE analysis_id = $1 ORDER BY id DESC LIMIT 10)", [id]);
      return true;
    });
  }

  async conversation(ownerId: string, id: string, now = Date.now()): Promise<{ question: string; answer: string; at: number }[]> {
    return this.guarded(async () => {
      const rows = await this.pool.query<{ question: string; answer: string; created_at: string }>("SELECT t.question, t.answer, t.created_at FROM vidsnap_conversation_turns t JOIN vidsnap_analyses a ON a.id = t.analysis_id JOIN vidsnap_sessions s ON s.owner_id = a.owner_id WHERE a.id = $1 AND a.owner_id = $2 AND a.status = 'completed' AND a.content_expires_at > $3 AND a.expires_at > $3 AND s.expires_at > $3 ORDER BY t.id DESC LIMIT 3", [id, ownerId, now]);
      return rows.rows.reverse().map(row => ({ question: row.question, answer: row.answer, at: Number(row.created_at) }));
    });
  }

  /** 返回待清理的帧清单；删记录与物理文件清理需要调用者协作并记录重试。 */
  async revoke(ownerId: string, id: string, now = Date.now()): Promise<{ frameManifest: unknown[] } | null> {
    return this.transaction(async client => {
      const updated = await client.query<{ frame_manifest: unknown[] }>("WITH target AS (SELECT a.id, a.frame_manifest FROM vidsnap_analyses a JOIN vidsnap_sessions s ON s.owner_id = a.owner_id WHERE a.id = $1 AND a.owner_id = $2 AND a.status <> 'deleted' AND s.expires_at > $3 FOR UPDATE OF a), removed AS (UPDATE vidsnap_analyses a SET status = 'deleted', revision = a.revision + 1, result_payload = NULL, evidence = NULL, frame_manifest = '[]'::jsonb, cleanup_pending = TRUE FROM target WHERE a.id = target.id RETURNING target.frame_manifest) SELECT frame_manifest FROM removed", [id, ownerId, now]);
      if (!updated.rowCount) return null;
      await client.query("DELETE FROM vidsnap_conversation_turns WHERE analysis_id = $1", [id]);
      return { frameManifest: updated.rows[0].frame_manifest };
    });
  }

  /** 调用者仅按服务端 analysisId 清理产物；失败时保留待处理标记。 */
  async pendingCleanup(): Promise<string[]> {
    return this.guarded(async () => (await this.pool.query<{ id: string }>("SELECT id FROM vidsnap_analyses WHERE cleanup_pending ORDER BY id LIMIT 100")).rows.map(row => row.id));
  }

  async acknowledgeCleanup(id: string): Promise<void> {
    await this.guarded(() => this.pool.query("UPDATE vidsnap_analyses SET cleanup_pending = FALSE WHERE id = $1 AND status = 'deleted' AND cleanup_pending", [id]));
  }
}
