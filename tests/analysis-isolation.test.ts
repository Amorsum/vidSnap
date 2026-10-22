import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

const videoId = "dQw4w9WgXcQ";
const created = new Set<string>();
let sequence = 0;
let main: typeof import("../src/app/api/process/route");
let followup: typeof import("../src/app/api/followup/route");
let frames: typeof import("../src/app/api/frames/route");
let verify: typeof import("../src/app/api/verify/route");
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
  transcriptSource: string;
  transcriptSegments: { start: number; end: number; text: string }[];
  metrics: { usage: unknown; cost: unknown };
}

before(async () => {
  process.env.VIDSNAP_TEST_MOCKS = "1";
  ({ mockState } = await import("./fixtures/mock-upstream.mjs"));
  main = await import("../src/app/api/process/route");
  followup = await import("../src/app/api/followup/route");
  frames = await import("../src/app/api/frames/route");
  verify = await import("../src/app/api/verify/route");
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

function request(body: unknown, cookie = "", method = "POST", headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: { "Content-Type": "application/json", "x-access-code": "isolation-test-only", "cf-connecting-ip": `test-isolation-${++sequence}`, cookie, ...headers },
    body: JSON.stringify(body),
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

test("帧签名不能跨会话转用，访问码回退仍要求归属，删除后立即拒绝", async () => {
  const owner = await processFor();
  const stranger = await processFor();
  const url = new URL(owner.data.frames[0].src, "http://localhost");
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: stranger.cookie, "x-access-code": "isolation-test-only" } }))).status, 404);
  assert.equal((await frames.GET(new NextRequest(url))).status, 404);
  url.searchParams.set("token", "invalid");
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: owner.cookie } }))).status, 401);
  assert.equal((await frames.GET(new NextRequest(url, { headers: { cookie: owner.cookie, "x-access-code": "isolation-test-only" } }))).status, 200);
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

for (const stage of ["summary", "embedding", "download"]) {
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
