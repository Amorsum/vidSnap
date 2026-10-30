import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

/** 明确列出迁移，避免执行目录中临时或未知 SQL 文件。 */
const migrations = ["001_analysis_storage.sql"] as const;
const migrationLock = "72349761320716";

export async function migratePersistence(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [migrationLock]);
      await client.query("CREATE TABLE IF NOT EXISTS vidsnap_schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
      for (const name of migrations) {
        const sql = await readFile(path.join(process.cwd(), "migrations", name), "utf8");
        const hash = createHash("sha256").update(sql).digest("hex");
        const applied = await client.query<{ sha256: string }>("SELECT sha256 FROM vidsnap_schema_migrations WHERE name = $1", [name]);
        if (applied.rows[0]) {
          if (applied.rows[0].sha256 !== hash) throw new Error("迁移文件与已执行版本不一致");
          continue;
        }
        await client.query(sql);
        await client.query("INSERT INTO vidsnap_schema_migrations(name, sha256) VALUES ($1, $2)", [name, hash]);
      }
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* 保留原始错误。 */ }
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}
