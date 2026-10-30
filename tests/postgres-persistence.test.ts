import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { PostgresAnalysisStore, digestSessionToken, PersistenceUnavailableError } from "../src/lib/persistence/postgres";
import { migratePersistence } from "../src/lib/persistence/migrate";

const url = process.env.VIDSNAP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/vidsnap_n1_test" || process.env.VIDSNAP_TEST_DATABASE_CONFIRMED !== "1") {
    throw new Error("持久化测试仅允许显式确认的本机 vidsnap_n1_test 数据库");
  }
}

test("PostgreSQL 恢复、归属、TTL、删除和失败回滚", { skip: !url }, async () => {
  assert.ok(url);
  // 并发调用必须只应用一次迁移，重复执行不得改写已有数据。
  await Promise.all([migratePersistence(url), migratePersistence(url)]);
  const token = randomBytes(32).toString("hex"), otherToken = randomBytes(32).toString("hex");
  const now = Date.now(), contentExpiry = now + 3600000, frameExpiry = now + 7200000;
  let store = new PostgresAnalysisStore(url);
  const inspect = new Pool({ connectionString: url });
  try {
    const migration = await inspect.query<{ sha256: string }>("SELECT sha256 FROM vidsnap_schema_migrations WHERE name = $1", ["001_analysis_storage.sql"]);
    assert.equal(migration.rowCount, 1);
    await inspect.query("UPDATE vidsnap_schema_migrations SET sha256 = $1 WHERE name = $2", ["mismatch", "001_analysis_storage.sql"]);
    try { await assert.rejects(migratePersistence(url), /迁移文件与已执行版本不一致/); }
    finally { await inspect.query("UPDATE vidsnap_schema_migrations SET sha256 = $1 WHERE name = $2", [migration.rows[0].sha256, "001_analysis_storage.sql"]); }
    await migratePersistence(url);
    const owner = await store.createSession(token, now + 86400000);
    const other = await store.createSession(otherToken, now + 86400000);
    assert.equal(await store.resolveSession("bad"), null);
    assert.equal(await store.resolveSession(token, now + 86400000), null);
    await assert.rejects(store.beginAnalysis(owner, "youtube", "dQw4w9WgXcQ", now, now), /期限/);
    const credentials = await inspect.query("SELECT token_hash FROM vidsnap_sessions WHERE owner_id = $1", [owner]);
    assert.deepEqual(credentials.rows[0].token_hash, digestSessionToken(token));
    assert.notEqual(credentials.rows[0].token_hash.toString("hex"), token);

    const id = await store.beginAnalysis(owner, "bilibili", "BV1L3tA66EKt_p1", frameExpiry, now);
    assert.ok(id);
    const unsafeFrame = { frameId: 1, time: 3, description: "画面", src: "https://example.invalid/?token=secret" };
    await assert.rejects(store.completeAnalysis(owner, id, 0, contentExpiry, {}, [], [unsafeFrame], frameExpiry, now), /帧元数据无效/);
    await assert.rejects(store.completeAnalysis(owner, id, 0, contentExpiry, {}, [], [{ frameId: 0, time: 3, description: "画面" }], frameExpiry, now), /帧元数据无效/);
    const repeated = { frameId: 1, time: 3, description: "画面" };
    await assert.rejects(store.completeAnalysis(owner, id, 0, contentExpiry, {}, [], [repeated, repeated], frameExpiry, now), /帧元数据无效/);
    assert.equal(await store.completeAnalysis(other, id, 0, contentExpiry, { overall: "fixture" }, [{ text: "依据" }], [], frameExpiry, now), false);
    assert.equal(await store.completeAnalysis(owner, id, 0, contentExpiry, { overall: "fixture" }, [{ text: "依据" }], [repeated], frameExpiry, now), true);
    assert.equal(await store.completeAnalysis(owner, id, 0, contentExpiry, {}, [], [], frameExpiry, now), false);
    assert.equal(await store.getCompleted(other, id, now), null);
    assert.equal(await store.getCompleted(owner, id, contentExpiry), null);

    for (let i = 0; i < 12; i++) assert.ok(await store.saveTurn(owner, id, `q${i}`, `a${i}`, now + i));
    assert.deepEqual((await store.conversation(owner, id, now + 20)).map(turn => turn.question), ["q9", "q10", "q11"]);
    await store.close();
    store = new PostgresAnalysisStore(url);
    assert.equal(await store.resolveSession(token, now + 20), owner);
    const restored = await store.getCompleted(owner, id, now + 20);
    assert.equal(restored?.contentExpiresAt, contentExpiry);
    assert.equal(restored?.framesExpireAt, frameExpiry);
    assert.deepEqual(restored?.evidence, [{ text: "依据" }]);
    assert.deepEqual(restored?.frameManifest, [repeated]);
    assert.deepEqual((await store.conversation(owner, id, now + 20)).map(turn => turn.question), ["q9", "q10", "q11"]);
    const program = `import storeModule from './src/lib/persistence/postgres.ts';
      const store = new storeModule.PostgresAnalysisStore(process.env.VIDSNAP_TEST_DATABASE_URL);
      const owner = await store.resolveSession(process.env.VIDSNAP_TEST_TOKEN);
      const result = owner && await store.getCompleted(owner, process.env.VIDSNAP_TEST_ANALYSIS_ID);
      process.stdout.write(JSON.stringify({ ownerMatches: owner === process.env.VIDSNAP_TEST_OWNER, resultExists: !!result }));
      await store.close();`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, VIDSNAP_TEST_TOKEN: token, VIDSNAP_TEST_OWNER: owner, VIDSNAP_TEST_ANALYSIS_ID: id },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { ownerMatches: true, resultExists: true });

    assert.equal(await store.revoke(other, id), null);
    const concurrent = await Promise.all([store.saveTurn(owner, id, "race", "race", now + 30), store.revoke(owner, id)]);
    assert.deepEqual(concurrent[1], { frameManifest: [repeated] });
    assert.equal(await store.getCompleted(owner, id, now + 31), null);
    assert.deepEqual(await store.conversation(owner, id, now + 31), []);
    assert.equal((await inspect.query("SELECT count(*)::int AS n FROM vidsnap_conversation_turns WHERE analysis_id = $1", [id])).rows[0].n, 0);
    assert.deepEqual((await inspect.query("SELECT frame_manifest FROM vidsnap_analyses WHERE id = $1", [id])).rows[0].frame_manifest, []);
    assert.ok((await store.pendingCleanup()).includes(id));
    await store.close();
    store = new PostgresAnalysisStore(url);
    assert.ok((await store.pendingCleanup()).includes(id));
    await store.acknowledgeCleanup(id);
    assert.ok(!(await store.pendingCleanup()).includes(id));
    assert.equal(await store.completeAnalysis(owner, id, 0, contentExpiry, {}, [], [], frameExpiry, now + 32), false);

    const failing = await store.beginAnalysis(owner, "youtube", "dQw4w9WgXcQ", frameExpiry, now);
    assert.ok(failing);
    await assert.rejects(store.completeAnalysis(owner, failing, 0, contentExpiry, {}, [], [], frameExpiry + 1, now), PersistenceUnavailableError);
    assert.equal((await inspect.query("SELECT status, result_payload FROM vidsnap_analyses WHERE id = $1", [failing])).rows[0].status, "running");
    assert.ok(await store.completeAnalysis(owner, failing, 0, contentExpiry, {}, [], [], frameExpiry, now));
    const shortToken = randomBytes(32).toString("hex");
    const shortOwner = await store.createSession(shortToken, now + 10000);
    const shortId = await store.beginAnalysis(shortOwner, "youtube", "dQw4w9WgXcQ", frameExpiry, now);
    assert.ok(shortId);
    assert.equal(await store.completeAnalysis(shortOwner, shortId, 0, contentExpiry, {}, [], [], frameExpiry, now + 10000), false);
    assert.ok(await store.completeAnalysis(shortOwner, shortId, 0, contentExpiry, {}, [], [], frameExpiry, now));
    assert.equal(await store.getCompleted(shortOwner, shortId, now + 10000), null);
    assert.equal(await store.saveTurn(shortOwner, shortId, "q", "a", now + 10000), false);
    assert.equal(await store.revoke(shortOwner, shortId, now + 10000), null);
    const unavailable = new PostgresAnalysisStore("postgresql://postgres@127.0.0.1:1/vidsnap_n1_test");
    try {
      await assert.rejects(unavailable.resolveSession(token), error => error instanceof PersistenceUnavailableError
        && !error.message.includes("127.0.0.1") && !error.message.includes(token));
    } finally { await unavailable.close(); }
  } finally { await store.close(); await inspect.end(); }
});
