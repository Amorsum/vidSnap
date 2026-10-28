import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import type { PipelineTimings } from "../src/lib/pipeline-timing";

const videoId = "dQw4w9WgXcQ";
const created = new Set<string>();
let sequence = 0;
let main: typeof import("../src/app/api/process/route");
let followup: typeof import("../src/app/api/followup/route");
let frames: typeof import("../src/app/api/frames/route");
let verify: typeof import("../src/app/api/session/route");
let analysisStatus: typeof import("../src/app/api/analyses/[analysisId]/route");
let sessions: typeof import("../src/lib/session");
let analyses: typeof import("../src/lib/analysis-store");
let transcripts: typeof import("../src/lib/transcript-store");
let conversations: typeof import("../src/lib/conversation-store");
let cache: typeof import("../src/lib/process-cache");
let artifacts: typeof import("../src/lib/analysis-artifacts");
let mockState: typeof import("./fixtures/mock-upstream.mjs").mockState;

interface ProcessData {
  analysisId: string;
  video: { id: string };
  frames: { src: string; time: number; description: string }[];
  cached: boolean;
  shared: boolean;
  transcriptSource: string;
  transcriptSegments: { start: number; end: number; text: string }[];
  metrics: { usage: unknown; cost: unknown; totalMs: number; summarizeMs: number; timings: PipelineTimings;
    visionStatus: { outcome: string; describedFrames: number; totalFrames: number; budgetMs: number } | null };
}

before(async () => {
  process.env.VIDSNAP_TEST_MOCKS = "1";
  ({ mockState } = await import("./fixtures/mock-upstream.mjs"));
  main = await import("../src/app/api/process/route");
  followup = await import("../src/app/api/followup/route");
  frames = await import("../src/app/api/frames/route");
  verify = await import("../src/app/api/session/route");
  analysisStatus = await import("../src/app/api/analyses/[analysisId]/route");
  sessions = await import("../src/lib/session");
  analyses = await import("../src/lib/analysis-store");
  transcripts = await import("../src/lib/transcript-store");
  conversations = await import("../src/lib/conversation-store");
  cache = await import("../src/lib/process-cache");
  artifacts = await import("../src/lib/analysis-artifacts");
});

after(async () => {
  for (const id of created) await artifacts.cleanupAnalysisArtifacts(id);
  const { getWhisperClient } = await import("../src/lib/whisper-client");
  await getWhisperClient().close();
  mockState.restore();
});

function request(body: unknown, cookie = "", method = "POST", headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: { "Content-Type": "application/json", "x-access-code": "isolation-test-only", "cf-connecting-ip": `test-isolation-${++sequence}`, cookie, ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

function cookieFor(response: Response) { return response.headers.get("set-cookie")?.split(";")[0] ?? ""; }

async function processFor(cookie = "") {
  const response = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie));
  assert.equal(response.status, 200);
  const events = (await response.text()).split("\n\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  const result = events.find((event) => event.type === "result");
  assert.ok(result, `应返回 result：${JSON.stringify(events)}`);
  const data: ProcessData = result.data;
  created.add(data.analysisId);
  return { data, cookie: cookieFor(response) || cookie, events };
}

function ask(data: ProcessData, cookie: string, question: string) {
  return followup.POST(request({ videoId, analysisId: data.analysisId, question }, cookie));
}

test("处理计时覆盖实际阶段，缓存请求只记录本次读取而不复制生成耗时", async () => {
  const original = await processFor();
  const timings = original.data.metrics.timings;
  for (const stage of ["metadata", "cache_lookup", "workspace", "download", "transcript", "vision", "summary", "embedding", "persist"] as const) {
    assert.equal(timings.stages[stage]?.outcome, "completed", stage);
    assert.ok(timings.stages[stage]!.ms >= 0);
  }
  assert.equal(original.data.metrics.summarizeMs, timings.stages.summary?.ms);
  assert.ok(timings.firstTokenMs! <= timings.summaryReadyMs!);
  assert.ok(timings.summaryReadyMs! <= timings.resultReadyMs!);
  const counts = mockState.counts();
  const cached = await processFor(original.cookie);
  assert.equal(cached.data.cached, true);
  assert.deepEqual(Object.keys(cached.data.metrics.timings.stages).sort(), ["cache_lookup", "cache_restore"]);
  assert.deepEqual(mockState.counts(), counts, "有效缓存不能调用平台解析、媒体或模型");
  assert.equal(cached.data.metrics.timings.firstTokenMs, null);
  assert.equal(cached.data.metrics.timings.summaryReadyMs, null);
});

test("同会话规范链接的不同分享形式复用缓存，其他会话仍需独立解析", async () => {
  const initial = await processFor();
  const before = mockState.counts();
  const response = await main.POST(request({ url: `https://www.youtube.com/watch?v=${videoId}&feature=share` }, initial.cookie));
  const events = (await response.text()).split("\n\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  assert.equal(events.find((event) => event.type === "result").data.analysisId, initial.data.analysisId);
  assert.equal(mockState.counts().metadata, before.metadata);
  const stranger = await processFor();
  assert.notEqual(stranger.data.analysisId, initial.data.analysisId);
  assert.equal(mockState.counts().metadata, before.metadata + 1);
});

for (const expires of ["analysis", "cache"]) {
  test(`${expires} 过期后重新解析和生成，不复用旧结果或续期旧分析`, async () => {
    const initial = await processFor();
    const analysis = analyses.getOwnedAnalysis(sessions.getSessionId(request({}, initial.cookie)), videoId, initial.data.analysisId)!;
    const oldDeadline = analysis.contentExpiresAt;
    if (expires === "analysis") analysis.contentExpiresAt = Date.now() - 1;
    else cache.getCachedResult(initial.data.analysisId)!.expiresAt = Date.now() - 1;
    const deadlineAfterExpiry = analysis.contentExpiresAt;
    const before = mockState.counts();
    const fresh = await processFor(initial.cookie);
    assert.equal(fresh.data.cached, false);
    assert.notEqual(fresh.data.analysisId, initial.data.analysisId);
    assert.equal(mockState.counts().metadata, before.metadata + 1);
    assert.equal(analysis.contentExpiresAt, deadlineAfterExpiry);
    if (expires === "cache") assert.equal(analysis.contentExpiresAt, oldDeadline);
  });
}

test("同会话规范链接变体在平台解析前合并，等待者不再解析或调用模型", { timeout: 15000 }, async () => {
  const verified = await verify.POST(request({ code: "isolation-test-only" }));
  const cookie = cookieFor(verified);
  const pause = mockState.pauseNext("metadata");
  const before = mockState.counts();
  try {
    const first = processFor(cookie);
    await pause.started;
    const response = await main.POST(request({ url: `https://www.youtube.com/shorts/${videoId}?feature=share` }, cookie));
    const read = response.text();
    assert.equal(mockState.counts().metadata, before.metadata + 1);
    pause.release();
    const completed = await first;
    const events = parseEvents(await read);
    const reused: ProcessData = events.find((event) => event.type === "result").data;
    assert.equal(completed.data.shared, false);
    assert.equal(reused.cached, true);
    assert.equal(reused.shared, true);
    assert.equal(reused.analysisId, completed.data.analysisId);
    assert.equal(reused.metrics.timings.stages.inflight_wait?.outcome, "completed");
    assert.equal(reused.metrics.timings.stages.metadata, undefined);
    assert.equal(reused.metrics.timings.firstTokenMs, null);
    assert.equal(reused.metrics.usage, null);
    assert.ok(!events.some((event) => event.type.startsWith("stream")));
    for (const key of ["metadata", "summary"] as const) assert.equal(mockState.counts()[key], before[key] + 1);
    const cached = await processFor(cookie);
    assert.equal(cached.data.shared, false);
    assert.equal(cached.data.cached, true);
  } finally { pause.release(); }
});

function parseEvents(text: string) {
  return text.split("\n\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
}

test("恢复请求只加入现有执行或读缓存，跨会话/过期/缺失均不调用上游", { timeout: 15000 }, async () => {
  const cookie = cookieFor(await verify.POST(request({ code: "isolation-test-only" })));
  const otherCookie = cookieFor(await verify.POST(request({ code: "isolation-test-only" })));
  const before = mockState.counts();
  const url = `https://youtu.be/${videoId}`;
  const noSession = await main.POST(request({ url, resumeOnly: true }));
  assert.equal(noSession.status, 404);
  assert.equal(noSession.headers.get("set-cookie"), null);
  assert.equal((await main.POST(request({ url, resumeOnly: true }, cookie))).status, 404);
  assert.equal((await main.POST(request({ url, resumeOnly: "true" }, cookie))).status, 400);
  const pause = mockState.pauseNext("summary");
  try {
    const controller = new AbortController();
    const response = await main.POST(request({ url }, cookie, "POST", {}, controller.signal));
    const reading = response.text();
    await pause.started;
    assert.equal((await main.POST(request({ url, resumeOnly: true }, otherCookie))).status, 404);
    const resumed = await main.POST(request({ url, resumeOnly: true }, cookie));
    const resumedRead = resumed.text();
    controller.abort();
    await reading;
    pause.release();
    const data: ProcessData = parseEvents(await resumedRead).find(event => event.type === "result").data;
    created.add(data.analysisId);
    assert.equal(data.shared, true);
    const cached = await main.POST(request({ url, resumeOnly: true, analysisId: data.analysisId }, cookie));
    assert.equal(parseEvents(await cached.text()).find(event => event.type === "result").data.analysisId, data.analysisId);
    const owned = analyses.getOwnedAnalysis(sessions.getSessionId(request({}, cookie)), videoId, data.analysisId)!;
    const expiry = owned.contentExpiresAt;
    owned.contentExpiresAt = Date.now() - 1;
    assert.equal((await main.POST(request({ url, resumeOnly: true, analysisId: data.analysisId }, cookie))).status, 404);
    owned.contentExpiresAt = expiry;
    const short = analyses.createAnalysis(owned.ownerId, "douyin", "1234");
    created.add(short.id);
    const shortExpiry = analyses.completeAnalysis(short);
    const originalCache = cache.getCachedResult(data.analysisId)!;
    cache.cacheResult(short.id, { ...originalCache, video: { ...originalCache.video, id: "1234" }, expiresAt: shortExpiry, frames: [] });
    const shortResponse = await main.POST(request({ url: "https://v.douyin.com/short/", resumeOnly: true, analysisId: short.id }, cookie));
    assert.equal(parseEvents(await shortResponse.text()).find(event => event.type === "result").data.analysisId, short.id);
    assert.equal((await main.POST(request({ url, resumeOnly: true, analysisId: data.analysisId }, otherCookie))).status, 404);
    assert.equal((await main.POST(request({ url: "https://youtu.be/abcdefghijk", resumeOnly: true, analysisId: data.analysisId }, cookie))).status, 404);
    assert.equal((await main.DELETE(request({ videoId, analysisId: data.analysisId }, cookie, "DELETE"))).status, 200);
    assert.equal((await main.POST(request({ url, resumeOnly: true, analysisId: data.analysisId }, cookie))).status, 404);
    for (const key of ["metadata", "summary"] as const) assert.equal(mockState.counts()[key], before[key] + 1);
  } finally { pause.release(); }
});

for (const disconnect of ["abort", "cancel"]) {
  test(`等待者 ${disconnect} 只脱离连接，不影响执行者或其他等待者`, { timeout: 15000 }, async () => {
    const cookie = cookieFor(await verify.POST(request({ code: "isolation-test-only" })));
    const pause = mockState.pauseNext("summary");
    try {
      const first = processFor(cookie);
      await pause.started;
      const controller = new AbortController();
      const response = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie, "POST", {}, controller.signal));
      if (disconnect === "cancel") await response.body!.cancel();
      else { controller.abort(); await response.text(); }
      const third = processFor(cookie);
      pause.release();
      const [completed, joined] = await Promise.all([first, third]);
      assert.equal(joined.data.analysisId, completed.data.analysisId);
      assert.equal(joined.data.shared, true);
      assert.ok(cache.getCachedResult(completed.data.analysisId));
      assert.ok(transcripts.getTranscript(completed.data.analysisId));
    } finally { pause.release(); }
  });
}

test("执行者断连后继续完成，同会话等待者收到结果且只总结一次", { timeout: 15000 }, async () => {
  const cookie = cookieFor(await verify.POST(request({ code: "isolation-test-only" })));
  const pause = mockState.pauseNext("summary");
  const before = mockState.counts();
  try {
    const controller = new AbortController();
    const first = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie, "POST", {}, controller.signal));
    const read = first.text();
    await pause.started;
    const joined = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie));
    const joinedRead = joined.text();
    controller.abort();
    assert.ok(!parseEvents(await read).some((event) => event.type === "result"));
    pause.release();
    const data: ProcessData = parseEvents(await joinedRead).find((event) => event.type === "result").data;
    created.add(data.analysisId);
    assert.equal(data.shared, true);
    assert.equal(mockState.counts().summary, before.summary + 1);
    assert.ok(cache.getCachedResult(data.analysisId));
    await assert.rejects(fs.stat(artifacts.analysisDirectory(data.analysisId, "media")), { code: "ENOENT" });
  } finally { pause.release(); }
});

test("另一个会话的同视频在途请求保持独立执行", { timeout: 15000 }, async () => {
  const pause = mockState.pauseNext("summary");
  const before = mockState.counts();
  try {
    const first = processFor();
    await pause.started;
    const other = await processFor();
    assert.equal(other.data.shared, false);
    assert.equal(mockState.counts().metadata, before.metadata + 2);
    assert.equal(mockState.counts().summary, before.summary + 2);
    pause.release();
    assert.notEqual((await first).data.analysisId, other.data.analysisId);
  } finally { pause.release(); }
});

for (const stage of ["metadata", "summary"]) {
  test(`共享执行 ${stage} 失败通知所有等待者，清理后同会话可以重试`, { timeout: 15000 }, async () => {
    const cookie = cookieFor(await verify.POST(request({ code: "isolation-test-only" })));
    const pause = mockState.pauseNext(stage);
    mockState.fail(stage);
    try {
      const first = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie));
      const firstRead = first.text();
      await pause.started;
      const joined = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie));
      const joinedRead = joined.text();
      pause.release();
      const [a, b] = (await Promise.all([firstRead, joinedRead])).map(parseEvents);
      const id = a.find((event) => event.analysisId)?.analysisId;
      if (stage === "summary") assert.ok(id);
      else assert.equal(id, undefined);
      if (id) created.add(id);
      assert.equal(a.find((event) => event.type === "error").message, b.find((event) => event.type === "error").message);
      assert.ok(!b.some((event) => event.type === "result"));
      assert.equal(b.find((event) => event.type === "error").metrics.timings.stages.inflight_wait.outcome, "failed");
      if (id) await assert.rejects(fs.stat(artifacts.analysisDirectory(id)), { code: "ENOENT" });
      mockState.fail();
      assert.equal((await processFor(cookie)).data.cached, false);
    } finally { pause.release(); mockState.fail(); }
  });
}

test("删除共享分析立即释放等待者，新一轮不受旧执行收尾影响", { timeout: 15000 }, async () => {
  const cookie = cookieFor(await verify.POST(request({ code: "isolation-test-only" })));
  const pause = mockState.pauseNext("summary");
  try {
    const first = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie));
    const firstRead = first.text();
    await pause.started;
    const analysis = analyses.getOwnedAnalysis(sessions.getSessionId(request({}, cookie)), videoId)!;
    created.add(analysis.id);
    const joined = await main.POST(request({ url: `https://youtu.be/${videoId}` }, cookie));
    const joinedRead = joined.text();
    assert.equal((await main.DELETE(request({ videoId, analysisId: analysis.id }, cookie, "DELETE"))).status, 200);
    const events = parseEvents(await joinedRead);
    assert.match(events.find((event) => event.type === "error").message, /已删除或过期/);
    assert.ok(!events.some((event) => event.type === "result"));
    const fresh = await processFor(cookie);
    assert.notEqual(fresh.data.analysisId, analysis.id);
    pause.release();
    assert.ok(!parseEvents(await firstRead).some((event) => event.type === "result"));
    assert.equal(cache.getCachedResult(analysis.id), null);
    assert.ok(cache.getCachedResult(fresh.data.analysisId));
    assert.equal((await processFor(cookie)).data.analysisId, fresh.data.analysisId);
  } finally { pause.release(); }
});

test("向量生成失败记录降级，仍返回总结且不假造未执行的视觉耗时", async () => {
  const previousVision = process.env.VISION_ENABLED;
  process.env.VISION_ENABLED = "0";
  mockState.fail("embedding");
  try {
    const result = await processFor();
    assert.equal(result.data.metrics.timings.stages.embedding?.outcome, "degraded");
    assert.equal(result.data.metrics.timings.stages.vision, undefined);
    assert.equal(result.data.frames.length, 0);
  } finally {
    mockState.fail();
    if (previousVision === undefined) delete process.env.VISION_ENABLED;
    else process.env.VISION_ENABLED = previousVision;
  }
});

test("总结失败的 SSE 保留失败阶段计时，不发送 result 就绪时间", async () => {
  mockState.fail("summary");
  try {
    const response = await main.POST(request({ url: `https://youtu.be/${videoId}` }));
    const events = (await response.text()).split("\n\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    const id = events.find((event) => event.analysisId)?.analysisId;
    if (id) created.add(id);
    const error = events.find((event) => event.type === "error");
    assert.equal(error.metrics.timings.stages.summary.outcome, "failed");
    assert.equal(error.metrics.timings.summaryReadyMs, null);
    assert.equal(error.metrics.timings.resultReadyMs, null);
    assert.equal(events.some((event) => event.type === "result"), false);
  } finally { mockState.fail(); }
});

test("匿名会话由服务器签发，陌生 cookie/body sessionId 不成为身份", async () => {
  const forged = `${sessions.SESSION_COOKIE}=${"0".repeat(64)}`;
  const response = await verify.POST(request({ code: "isolation-test-only", sessionId: "forged" }, forged));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.notEqual(cookieFor(response), forged);
  assert.equal(sessions.getSessionId(request({}, forged)), null);
  assert.ok(sessions.getSessionId(request({}, cookieFor(response))));
  assert.deepEqual(await response.json(), { success: true });
  const secure = sessions.ensureSession(new Request("https://example.test"));
  assert.match(secure.cookie!, /; Secure/);
});

test("写接口拒绝跨站/同站不同源/Origin null 和表单内容类型", async () => {
  const badHeaders: Record<string, string>[] = [
    { origin: "https://evil.test" }, { origin: "null" }, { origin: "http://sibling.localhost" },
    { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" },
  ];
  for (const handler of [main.POST, main.DELETE, followup.POST, verify.POST]) {
    for (const headers of badHeaders) assert.equal((await handler(request({}, "", "POST", headers))).status, 403);
  }
  assert.equal((await main.POST(request({}, "", "POST", { origin: "http://localhost" }))).status, 400);
  assert.equal((await main.POST(request({}, "", "POST", { origin: "https://vidsnap.example", host: "vidsnap.example" }))).status, 400);
});

test("会话容量满返回 503，不误报坏 JSON 或淘汰现有会话", async () => {
  const table = (globalThis as typeof globalThis & { vidsnapSessions: Map<string, number> }).vidsnapSessions;
  const previous = new Map(table);
  try {
    for (let index = 0; table.size < 10000; index++) table.set(index.toString(16).padStart(64, "0"), Date.now() + 60000);
    for (const [handler, body] of [[verify.POST, { code: "isolation-test-only" }], [main.POST, { url: `https://youtu.be/${videoId}` }]] as const) {
      const response = await handler(request(body));
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /容量/);
    }
    for (const [id, expiry] of previous) assert.equal(table.get(id), expiry);
  } finally {
    table.clear();
    for (const [id, expiry] of previous) table.set(id, expiry);
  }
});

test("两个会话同视频独立结果、媒体和对话；跨会话访问/删除拒绝", async () => {
  const first = await processFor();
  const second = await processFor();
  assert.notEqual(first.data.analysisId, second.data.analysisId);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal(first.data.cached, false);
  assert.equal(second.data.cached, false);
  assert.equal((await ask(first.data, first.cookie, "甲的私有问题")).status, 200);
  assert.equal((await ask(second.data, second.cookie, "乙的问题")).status, 200);
  assert.equal(conversations.getConversation(first.data.analysisId)[0].question, "甲的私有问题");
  assert.equal(conversations.getConversation(second.data.analysisId)[0].question, "乙的问题");
  assert.equal((await ask(first.data, second.cookie, "越权问题")).status, 404);
  assert.equal((await ask(first.data, "", "无 cookie 问题")).status, 404);
  assert.equal((await main.DELETE(request({ videoId, analysisId: first.data.analysisId }, second.cookie, "DELETE"))).status, 404);
  await assert.rejects(fs.stat(artifacts.analysisDirectory(first.data.analysisId, "media")), { code: "ENOENT" });
  assert.equal((await fs.readdir(artifacts.analysisDirectory(first.data.analysisId, "frames"))).length, 3);
  const deleted = await main.DELETE(request({ videoId, analysisId: first.data.analysisId }, first.cookie, "DELETE"));
  assert.equal(deleted.status, 200);
  assert.equal(cache.getCachedResult(first.data.analysisId), null);
  assert.equal(transcripts.getTranscript(first.data.analysisId), null);
  assert.deepEqual(conversations.getConversation(first.data.analysisId), []);
  assert.ok(cache.getCachedResult(second.data.analysisId));
  assert.equal((await fs.readdir(artifacts.analysisDirectory(second.data.analysisId, "frames"))).length, 3);
});

test("SSE 保留流/结果契约，备用模型完成顺序不改变图片身份", async () => {
  const { data, events, cookie } = await processFor();
  assert.equal(data.transcriptSource, "builtin");
  assert.equal(data.transcriptSegments.length, 2);
  assert.equal(data.video.id, videoId);
  assert.equal(data.metrics.usage, null);
  assert.equal(data.metrics.cost, null);
  assert.ok(events.some((event) => event.type === "progress"));
  for (const type of ["stream_start", "stream", "stream_end", "result"]) assert.ok(events.some((event) => event.type === type));
  for (let i = 0; i < data.frames.length; i++) {
    const frame = data.frames[i];
    const frameUrl = new URL(frame.src, "http://localhost");
    assert.equal(frameUrl.searchParams.get("idx"), String(i + 1));
    assert.equal(frame.description, `第${i + 1}帧画面证据`);
    const response = await frames.GET(new NextRequest(frameUrl, { headers: { cookie, "cf-connecting-ip": `test-frame-${++sequence}` } }));
    assert.equal(response.status, 200);
    assert.ok(Buffer.from(await response.arrayBuffer()).toString().endsWith(`mock-frame-${i + 1}`));
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
});

test("帧签名不能跨会话转用，旧访问码不能绕过签名，删除后立即拒绝", async () => {
  const owner = await processFor();
  const stranger = await processFor();
  const url = new URL(owner.data.frames[0].src, "http://localhost");
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: stranger.cookie, "x-access-code": "isolation-test-only" } }))).status, 404);
  assert.equal((await frames.GET(new NextRequest(url))).status, 404);
  url.searchParams.set("token", "invalid");
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: owner.cookie } }))).status, 401);
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: owner.cookie, "x-access-code": "isolation-test-only" } }))).status, 401);
  await main.DELETE(request({ videoId, analysisId: owner.data.analysisId }, owner.cookie, "DELETE"));
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: owner.cookie, "x-access-code": "isolation-test-only" } }))).status, 404);
});

test("同会话缓存复用完整画面证据和向量，不刷新内容 TTL/历史", async () => {
  const initial = await processFor();
  const stored = transcripts.getTranscript(initial.data.analysisId)!;
  const evidence = structuredClone(stored.segments);
  assert.equal(evidence.filter((segment) => segment.text.startsWith("【画面】")).length, 3);
  assert.ok(evidence.every((segment) => segment.embedding?.length === 3));
  await ask(initial.data, initial.cookie, "保留历史");
  const beforeCounts = mockState.counts();
  transcripts.removeTranscript(initial.data.analysisId);
  const cached = await processFor(initial.cookie);
  assert.equal(cached.data.analysisId, initial.data.analysisId);
  assert.equal(cached.data.cached, true);
  const restored = transcripts.getTranscript(initial.data.analysisId)!;
  assert.deepEqual(restored.segments, evidence);
  assert.equal(restored.expiresAt, stored.expiresAt);
  assert.equal(conversations.getConversation(initial.data.analysisId)[0].question, "保留历史");
  const afterCounts = mockState.counts();
  for (const key of ["download", "vision", "summary", "embedding"] as const) assert.equal(afterCounts[key], beforeCounts[key]);
});

test("缓存读取移除已过期帧 URL，但保留文字证据", async () => {
  const initial = await processFor();
  const analysis = analyses.getOwnedAnalysis(sessions.getSessionId(request({}, initial.cookie)), videoId, initial.data.analysisId)!;
  analysis.framesExpireAt = Date.now() - 1;
  const cached = await processFor(initial.cookie);
  assert.equal(cached.data.cached, true);
  assert.deepEqual(cached.data.frames, []);
  assert.equal(transcripts.getTranscript(analysis.id)?.segments.filter((segment) => segment.text.startsWith("【画面】")).length, 3);
});

test("未配置可选视觉/向量 key 仍完成文字总结，缺 usage 不伪造指标", async () => {
  const previous = process.env.SENSEVOICE_API_KEY;
  delete process.env.SENSEVOICE_API_KEY;
  try {
    const result = await processFor();
    assert.deepEqual(result.data.frames, []);
    assert.equal(result.data.metrics.usage, null);
    assert.equal(result.data.metrics.cost, null);
    assert.equal(transcripts.getTranscript(result.data.analysisId)?.segments.length, 2);
  } finally { process.env.SENSEVOICE_API_KEY = previous; }
});

for (const stage of ["summary", "embedding", "download", "vision"]) {
  test(`处理在 ${stage} 阶段被删除：停止后续阶段且不回写结果`, { timeout: 15000 }, async () => {
    const pause = mockState.pauseNext(stage);
    try {
      const response = await main.POST(request({ url: `https://youtu.be/${videoId}` }));
      const cookie = cookieFor(response);
      const read = response.text();
      await pause.started;
      const analysis = analyses.getOwnedAnalysis(sessions.getSessionId(request({}, cookie)), videoId)!;
      created.add(analysis.id);
      assert.equal((await main.DELETE(request({ videoId, analysisId: analysis.id }, cookie, "DELETE"))).status, 200);
      pause.release();
      const output = await read;
      assert.doesNotMatch(output, /"type":"result"/);
      assert.match(output, /已删除或过期/);
      assert.equal(cache.getCachedResult(analysis.id), null);
      assert.equal(transcripts.getTranscript(analysis.id), null);
      await assert.rejects(fs.stat(artifacts.analysisDirectory(analysis.id)), { code: "ENOENT" });
    } finally { pause.release(); }
  });
}

for (const mode of ["vision", "vision-timeout", "vision-short-budget"]) {
  test(`${mode} 降级仍完成文字总结及追问，不缓存未完成画面证据`, { timeout: 15000 }, async () => {
    const previous = process.env.VISION_TIMEOUT_MS;
    const timeout = mode === "vision-short-budget" ? 1000 : 4000;
    process.env.VISION_TIMEOUT_MS = String(timeout);
    mockState.fail(mode);
    const before = mockState.counts();
    try {
      const { data, cookie } = await processFor();
      assert.equal(data.metrics.timings.stages.vision?.outcome, "degraded");
      assert.equal(data.metrics.visionStatus?.outcome, mode === "vision" ? "failed" : "budget_exhausted");
      assert.equal(data.metrics.visionStatus?.budgetMs, timeout);
      assert.deepEqual(data.frames, []);
      assert.ok(transcripts.getTranscript(data.analysisId)!.segments.every((segment) => !segment.text.startsWith("【画面】")));
      assert.equal((await ask(data, cookie, "字幕内容是什么")).status, 200);
      assert.equal(mockState.counts().vision, before.vision + (mode === "vision" ? 3 : mode === "vision-timeout" ? 1 : 0));
      const cached = await processFor(cookie);
      assert.equal(cached.data.cached, true);
      assert.equal(cached.data.metrics.visionStatus, null, "缓存读取不冒充本次执行过视觉");
      assert.deepEqual(cached.data.frames, []);
    } finally {
      mockState.fail();
      if (previous === undefined) delete process.env.VISION_TIMEOUT_MS;
      else process.env.VISION_TIMEOUT_MS = previous;
    }
  });
}

test("追问执行中删除：模型返回后不恢复历史、不泄出答案", { timeout: 15000 }, async () => {
  const initial = await processFor();
  const pause = mockState.pauseNext("followup");
  try {
    const pending = ask(initial.data, initial.cookie, "在途问题");
    await pause.started;
    await main.DELETE(request({ videoId, analysisId: initial.data.analysisId }, initial.cookie, "DELETE"));
    pause.release();
    const response = await pending;
    assert.equal(response.status, 404);
    assert.equal((await response.json()).answer, undefined);
    assert.deepEqual(conversations.getConversation(initial.data.analysisId), []);
  } finally { pause.release(); }
});

for (const stage of ["download", "summary"]) {
  test(`${stage} 异常只清理本次分析，不影响已完成的另一个会话`, async () => {
    const completed = await processFor();
    mockState.fail(stage);
    try {
      const response = await main.POST(request({ url: `https://youtu.be/${videoId}` }));
      const events = (await response.text()).split("\n\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
      const id = events.find((event) => event.analysisId)?.analysisId;
      assert.ok(id);
      created.add(id);
      assert.ok(events.some((event) => event.type === "error"));
      await assert.rejects(fs.stat(artifacts.analysisDirectory(id)), { code: "ENOENT" });
      assert.ok(cache.getCachedResult(completed.data.analysisId));
      assert.ok(await fs.stat(path.join(artifacts.analysisDirectory(completed.data.analysisId, "frames"), `${videoId}-kf-001.jpg`)));
    } finally { mockState.fail(); }
  });
}

for (const mode of ["cloud-success", "local-success"]) {
  test(`${mode}：保持云端优先与常驻失败到脚本兜底，SSE 返回结果`, async () => {
    const before = mockState.counts();
    mockState.asr(mode);
    try {
      const result = await processFor();
      assert.equal(result.data.transcriptSource, "whisper");
      assert.match(result.data.transcriptSegments[0].text, mode === "cloud-success" ? /云端转写/ : /本地转写/);
      assert.equal(mockState.counts().cloud, before.cloud + 1);
      assert.equal(mockState.counts().whisper, before.whisper + (mode === "local-success" ? 1 : 0));
    } finally { mockState.asr(); }
  });
}

for (const mode of ["empty-subtitle", "invalid-subtitle"]) {
  test(`${mode}：字幕内容不可用时下载音频并完成转写，不误报无语音`, async () => {
    const before = mockState.counts();
    mockState.asr(mode);
    try {
      const result = await processFor();
      assert.equal(result.data.transcriptSource, "whisper");
      assert.equal(result.data.transcriptSegments[0].text, "本地转写证据");
      assert.equal(mockState.counts().cloud, before.cloud + 1);
      assert.equal(mockState.counts().whisper, before.whisper + 1);
    } finally { mockState.asr(); }
  });
}

test("没有可选云端 key 仍可经本地脚本完成转写", async () => {
  const previous = process.env.SENSEVOICE_API_KEY;
  const before = mockState.counts();
  delete process.env.SENSEVOICE_API_KEY;
  mockState.asr("local-success");
  try {
    const result = await processFor();
    assert.equal(result.data.transcriptSegments[0].text, "本地转写证据");
    assert.equal(mockState.counts().cloud, before.cloud);
    assert.equal(mockState.counts().whisper, before.whisper + 1);
  } finally { process.env.SENSEVOICE_API_KEY = previous; mockState.asr(); }
});

for (const mode of ["local-error", "local-empty"]) {
  test(`${mode}：SSE 明确失败并清理本次分析，下次仍可成功`, async () => {
    mockState.asr(mode);
    try {
      const response = await main.POST(request({ url: `https://youtu.be/${videoId}` }));
      const output = await response.text();
      const events = output.split("\n\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
      const id = events.find((event) => event.analysisId)?.analysisId;
      assert.ok(id);
      created.add(id);
      assert.ok(events.some((event) => event.type === "error"));
      assert.doesNotMatch(output, /private|"type":"result"/);
      assert.match(output, mode === "local-empty" ? /没有检测到语音/ : /本地转写服务暂不可用/);
      assert.equal(transcripts.getTranscript(id), null);
      await assert.rejects(fs.stat(artifacts.analysisDirectory(id)), { code: "ENOENT" });
      mockState.asr("local-success");
      assert.equal((await processFor()).data.transcriptSegments[0].text, "本地转写证据");
    } finally { mockState.asr(); }
  });
}


test("analysis status is read-only, owned, uncached, and respects expiry/deletion", async () => {
  const initial = await processFor();
  const status = (id = initial.data.analysisId, cookie = initial.cookie, code = "isolation-test-only") => analysisStatus.GET(
    new NextRequest("http://localhost/api/analyses/" + id, { headers: { cookie, "x-access-code": code, "cf-connecting-ip": `status-${++sequence}` } }),
    { params: Promise.resolve({ analysisId: id }) });
  const active = await status();
  assert.equal(active.status, 200);
  assert.equal(active.headers.get("cache-control"), "private, no-store");
  const data = await active.json();
  assert.equal(data.canFollowUp, true);
  const owner = sessions.getSessionId(request({}, initial.cookie));
  const analysis = analyses.getOwnedAnalysis(owner, videoId, initial.data.analysisId)!;
  assert.equal(data.expiresAt, analysis.contentExpiresAt);
  assert.equal((await status(initial.data.analysisId, "")).status, 404);
  assert.equal((await status("invalid")).status, 404);
  assert.equal((await status(initial.data.analysisId, initial.cookie, "wrong")).status, 200);
  transcripts.getTranscript(initial.data.analysisId)!.expiresAt = Date.now() - 1;
  assert.equal((await (await status()).json()).canFollowUp, false);
  analyses.revokeAnalysis(analysis);
  assert.equal((await status()).status, 404);
});

test("learning metadata survives cache without renewing content deadlines", async () => {
  mockState.asr("cloud-success");
  try {
    const first = await processFor();
    const replay = await processFor(first.cookie);
    const raw = first.events.find(event => event.type === "result").data;
    const cached = replay.events.find(event => event.type === "result").data;
    assert.deepEqual(raw.transcription, { provider: "sensevoice", timing: "estimated" });
    assert.deepEqual(cached.transcription, raw.transcription);
    assert.deepEqual(cached.vision, raw.vision);
    assert.equal(cached.expiresAt, raw.expiresAt);
    assert.equal(raw.platform, "youtube");
    assert.equal(raw.canonicalUrl, `https://www.youtube.com/watch?v=${videoId}`);
    assert.ok(raw.framesExpireAt > raw.expiresAt);
  } finally { mockState.asr(); }
});

test("B 站分 P 独立缓存、SSE、追问与来源链接", async () => {
  const cookie = cookieFor(await verify.POST(request({})));
  const run = async (page: number) => {
    const response = await main.POST(request({ url: `https://www.bilibili.com/video/BV1xx411c7mD?p=${page}` }, cookie));
    assert.equal(response.status, 200);
    const result = parseEvents(await response.text()).find(event => event.type === "result")?.data;
    assert.ok(result);
    created.add(result.analysisId);
    return result;
  };
  const first = await run(1), second = await run(2), cached = await run(2);
  assert.equal(first.video.id, "BV1xx411c7mD_p1");
  assert.equal(second.video.id, "BV1xx411c7mD_p2");
  assert.notEqual(first.analysisId, second.analysisId);
  assert.equal(cached.analysisId, second.analysisId);
  assert.equal(cached.cached, true);
  assert.equal(second.platform, "bilibili");
  assert.equal(second.canonicalUrl, "https://www.bilibili.com/video/BV1xx411c7mD?p=2");
  assert.equal((await followup.POST(request({ videoId: second.video.id, analysisId: second.analysisId, question: "总结要点" }, cookie))).status, 200);
  assert.equal((await main.DELETE(request({ videoId: second.video.id, analysisId: second.analysisId }, cookie, "DELETE"))).status, 200);
});

test("B 站媒体策略拒绝时，SSE 提示网络校验而非错误要求登录", async () => {
  mockState.fail("network-policy");
  try {
    const response = await main.POST(request({ url: "https://www.bilibili.com/video/BV1xx411c7mD?p=1" }));
    const events = parseEvents(await response.text());
    const failure = events.find(event => event.type === "error");
    assert.ok(failure);
    assert.match(failure.message, /网络校验/);
    assert.doesNotMatch(failure.message, /登录|cookies/);
  } finally { mockState.fail(); }
});

test("长视频经 SSE 分段转写，缓存保留时间偏移与估算标记", async () => {
  mockState.asr("cloud-long");
  const url = "https://www.bilibili.com/video/BV1xx411c7mD?p=1";
  const before = mockState.counts();
  try {
    const response = await main.POST(request({ url }));
    const cookie = cookieFor(response);
    const events = parseEvents(await response.text());
    const data = events.find(event => event.type === "result")?.data;
    assert.ok(data);
    created.add(data.analysisId);
    assert.deepEqual(data.transcription, { provider: "sensevoice", timing: "estimated" });
    assert.deepEqual(data.transcriptSegments.map((segment: { start: number }) => segment.start), [0, 300, 600]);
    assert.equal(mockState.counts().cloud - before.cloud, 3);
    assert.ok(events.some(event => event.type === "progress" && event.step === "transcribing"));
    assert.ok(events.some(event => event.type === "stream_start"));
    assert.ok(events.some(event => event.type === "stream_end"));
    const cached = await main.POST(request({ url }, cookie));
    const replay = parseEvents(await cached.text()).find(event => event.type === "result")?.data;
    assert.equal(replay.cached, true);
    assert.deepEqual(replay.transcriptSegments, data.transcriptSegments);
    assert.deepEqual(replay.transcription, data.transcription);
    assert.equal(mockState.counts().cloud - before.cloud, 3);
  } finally { mockState.asr(); }
});
