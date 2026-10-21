import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createAnalysis, getOwnedAnalysis, findReusableAnalysis, completeAnalysis, revokeAnalysis, assertAnalysisActive, CONTENT_TTL_MS, ARTIFACT_TTL_MS } from "../src/lib/analysis-store";
import { analysisDirectory, ensureAnalysisDirectories, validateAnalysisDirectory, cleanupAnalysisArtifacts, sweepAnalysisArtifacts, scheduleAnalysisCleanup } from "../src/lib/analysis-artifacts";
import { saveTranscript, getTranscript, removeTranscript } from "../src/lib/transcript-store";
import { cacheResult, getCachedResult } from "../src/lib/process-cache";
import { saveTurn, getConversation, clearConversation } from "../src/lib/conversation-store";
import { ensureSession, getSessionId, SESSION_COOKIE } from "../src/lib/session";
import { signFrameToken, verifyFrameToken } from "../src/lib/vision";
import { ServiceCapacityError } from "../src/lib/request-validation";

const video = { id: "dQw4w9WgXcQ", title: "测试", duration: 10, thumbnail: "", uploader: "测试" };
const segments = [{ start: 0, end: 5, text: "测试字幕" }];

test("分析归属同时校验服务端会话、分析 ID 和源视频 ID", () => {
  const analysis = createAnalysis("owner-unit", "youtube", video.id);
  assert.equal(getOwnedAnalysis("owner-unit", video.id, analysis.id), analysis);
  assert.equal(getOwnedAnalysis("other-unit", video.id, analysis.id), null);
  assert.equal(getOwnedAnalysis(null, video.id, analysis.id), null);
  assert.equal(getOwnedAnalysis("owner-unit", "other-video", analysis.id), null);
  revokeAnalysis(analysis);
  assert.throws(() => assertAnalysisActive(analysis));
  assert.equal(getOwnedAnalysis("owner-unit", video.id, analysis.id), null);
  assert.throws(() => completeAnalysis(analysis));
});

test("分析容量满时拒绝接收，不驱逐仍有效的用户分析", () => {
  const table = (globalThis as typeof globalThis & { vidsnapAnalyses: Map<string, ReturnType<typeof createAnalysis>> }).vidsnapAnalyses;
  const previous = new Map(table);
  try {
    while (table.size < 1000) createAnalysis("capacity-unit", "youtube", video.id);
    const existing = [...table.values()].find((analysis) => analysis.status === "running")!;
    assert.throws(() => createAnalysis("new-owner", "youtube", video.id), ServiceCapacityError);
    assert.equal(getOwnedAnalysis(existing.ownerId, existing.videoId, existing.id), existing);
    assert.equal(table.size, 1000);
  } finally {
    table.clear();
    for (const [id, analysis] of previous) table.set(id, analysis);
  }
});

test("平台隔离与旧 videoId 唯一匹配保护", () => {
  const first = createAnalysis("collision-unit", "youtube", "12345678901");
  const second = createAnalysis("collision-unit", "douyin", "12345678901");
  completeAnalysis(first);
  assert.throws(() => completeAnalysis(first), /重复提交/);
  completeAnalysis(second);
  assert.equal(getOwnedAnalysis("collision-unit", "12345678901"), null);
  assert.equal(getOwnedAnalysis("collision-unit", "12345678901", first.id), first);
  assert.equal(findReusableAnalysis("collision-unit", "youtube", "12345678901"), first);
  assert.equal(findReusableAnalysis("collision-unit", "douyin", "12345678901"), second);
});

test("字幕、结果与对话在同一绝对时刻到期；追问不续期", () => {
  const id = randomUUID();
  const initial = Date.now();
  const time = mock.method(Date, "now", () => initial);
  try {
    const expiresAt = initial + CONTENT_TTL_MS;
    saveTranscript(id, segments, video, [[1, 0]], expiresAt);
    cacheResult(id, { video, transcriptSource: "builtin", transcriptText: "测试字幕", transcriptSegments: segments,
      evidenceSegments: segments, result: {}, expiresAt });
    saveTurn(id, "初始问题", "答案", expiresAt);
    time.mock.mockImplementation(() => expiresAt - 1);
    saveTurn(id, "最后一刻的问题", "答案", expiresAt);
    assert.equal(getTranscript(id)?.expiresAt, expiresAt);
    assert.ok(getCachedResult(id));
    assert.equal(getConversation(id).length, 2);
    time.mock.mockImplementation(() => expiresAt);
    assert.equal(getTranscript(id), null);
    assert.equal(getCachedResult(id), null);
    assert.deepEqual(getConversation(id), []);
    saveTurn(id, "过期问题", "答案", expiresAt);
    assert.deepEqual(getConversation(id), []);
  } finally { time.mock.restore(); }
});

test("同视频不同分析的存储与删除互不影响，对话只留最近 10 轮", () => {
  const first = randomUUID();
  const second = randomUUID();
  const expiresAt = Date.now() + CONTENT_TTL_MS;
  saveTranscript(first, segments, video);
  saveTranscript(second, segments, video);
  for (let i = 0; i < 12; i++) saveTurn(first, `问题${i}`, "回答", expiresAt);
  saveTurn(second, "另一个分析", "回答", expiresAt);
  assert.equal(getConversation(first, 20).length, 10);
  assert.equal(getConversation(first, 20)[0].question, "问题2");
  assert.deepEqual(getConversation(first, 0), []);
  removeTranscript(first);
  clearConversation(first);
  assert.ok(getTranscript(second));
  assert.equal(getConversation(second)[0].question, "另一个分析");
  removeTranscript(second);
  clearConversation(second);
});

test("会话有效期固定 24 小时，未知或过期 cookie 不可复用", () => {
  const initial = Date.now();
  const time = mock.method(Date, "now", () => initial);
  try {
    const first = ensureSession(new Request("http://localhost"));
    const request = new Request("http://localhost", { headers: { cookie: `${SESSION_COOKIE}=${first.id}` } });
    assert.equal(getSessionId(request), first.id);
    assert.equal(ensureSession(request).cookie, undefined);
    time.mock.mockImplementation(() => initial + 24 * CONTENT_TTL_MS);
    assert.equal(getSessionId(request), null);
    assert.notEqual(ensureSession(request).id, first.id);
  } finally { time.mock.restore(); }
});

test("分析内容到期后不再缓存复用，帧归属可保留至帧有效期", () => {
  const initial = Date.now();
  const time = mock.method(Date, "now", () => initial);
  try {
    const analysis = createAnalysis("expiry-unit", "youtube", video.id);
    analysis.framesExpireAt = initial + ARTIFACT_TTL_MS;
    completeAnalysis(analysis);
    time.mock.mockImplementation(() => initial + CONTENT_TTL_MS);
    assert.equal(findReusableAnalysis("expiry-unit", "youtube", video.id), null);
    assert.equal(getOwnedAnalysis("expiry-unit", video.id, analysis.id), analysis);
    time.mock.mockImplementation(() => initial + ARTIFACT_TTL_MS);
    assert.equal(getOwnedAnalysis("expiry-unit", video.id, analysis.id), null);
    assert.throws(() => assertAnalysisActive(analysis));
  } finally { time.mock.restore(); }
});

test("签名绑定分析与帧索引，期限不超过文件有效期", async () => {
  const first = randomUUID();
  const expiresAt = Date.now() + 30000;
  const token = await signFrameToken(first, 2, expiresAt);
  assert.equal(Number(token.split(".")[0]), expiresAt);
  assert.equal(await verifyFrameToken(token, first, 2), true);
  assert.equal(await verifyFrameToken(token, randomUUID(), 2), false);
  assert.equal(await verifyFrameToken(token, first, 1), false);
  assert.equal(await verifyFrameToken(`${expiresAt}.forged`, first, 2), false);
  assert.equal(await verifyFrameToken(await signFrameToken(first, 2, Date.now() - 1), first, 2), false);
});

test("任务目录严格 UUID 白名单；清理一份不会误删邻近任务", async () => {
  for (const id of ["", "..", "../other", "a/b", "a\\b", "prefix", "0".repeat(64)]) assert.throws(() => analysisDirectory(id));
  const first = randomUUID();
  const second = randomUUID();
  try {
    const a = await ensureAnalysisDirectories(first);
    const b = await ensureAnalysisDirectories(second);
    await fs.writeFile(path.join(a.media, "same-video.m4a"), "first");
    await fs.writeFile(path.join(a.frames, "frame.jpg"), "frame");
    await fs.writeFile(path.join(b.media, "same-video.m4a"), "second");
    await cleanupAnalysisArtifacts(first, "media");
    assert.equal(await fs.readFile(path.join(a.frames, "frame.jpg"), "utf8"), "frame");
    await cleanupAnalysisArtifacts(first);
    assert.equal(await fs.readFile(path.join(b.media, "same-video.m4a"), "utf8"), "second");
  } finally {
    await cleanupAnalysisArtifacts(first);
    await cleanupAnalysisArtifacts(second);
  }
});

test("拒绝链接目录访问与清理，不跟随 junction 删除另一任务", async () => {
  const first = randomUUID();
  const second = randomUUID();
  try {
    const a = await ensureAnalysisDirectories(first);
    const b = await ensureAnalysisDirectories(second);
    await fs.writeFile(path.join(b.frames, "keep.jpg"), "keep");
    await fs.rmdir(a.frames);
    await fs.symlink(b.frames, a.frames, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(validateAnalysisDirectory(first, "frames"), /符号链接/);
    await assert.rejects(cleanupAnalysisArtifacts(first, "frames"), /符号链接/);
    await cleanupAnalysisArtifacts(first);
    assert.equal(await fs.readFile(path.join(b.frames, "keep.jpg"), "utf8"), "keep");
  } finally {
    await cleanupAnalysisArtifacts(first);
    await cleanupAnalysisArtifacts(second);
  }
});

test("启动/懒清理只回收过期任务目录，保留新任务", async () => {
  const first = randomUUID();
  const second = randomUUID();
  try {
    await ensureAnalysisDirectories(first);
    const fresh = await ensureAnalysisDirectories(second);
    await fs.writeFile(path.join(fresh.frames, "keep.jpg"), "keep");
    const old = new Date(Date.now() - ARTIFACT_TTL_MS - 5000);
    for (const directory of [analysisDirectory(first), analysisDirectory(first, "media"), analysisDirectory(first, "frames")]) await fs.utimes(directory, old, old);
    await sweepAnalysisArtifacts();
    await assert.rejects(fs.stat(analysisDirectory(first)), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(fresh.frames, "keep.jpg"), "utf8"), "keep");
  } finally {
    await cleanupAnalysisArtifacts(first);
    await cleanupAnalysisArtifacts(second);
  }
});

test("帧目录到期独立清理，不因文字结果期限较晚而续期", async () => {
  const id = randomUUID();
  try {
    const directories = await ensureAnalysisDirectories(id);
    await fs.writeFile(path.join(directories.frames, "frame.jpg"), "frame");
    await fs.writeFile(path.join(directories.media, "keep.m4a"), "keep");
    scheduleAnalysisCleanup(id, Date.now() + 5, "frames");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(fs.stat(directories.frames), { code: "ENOENT" });
    assert.equal(await fs.readFile(path.join(directories.media, "keep.m4a"), "utf8"), "keep");
  } finally { await cleanupAnalysisArtifacts(id); }
});
