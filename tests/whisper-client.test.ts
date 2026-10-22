import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { WhisperClient, WhisperFailure, parseWhisperTranscript, type WhisperTranscript } from "../src/lib/whisper-client";

const fixture = path.join(process.cwd(), "tests", "fixtures", "whisper-worker.mjs");
const fallbackResult = { text: "脚本兜底", segments: [{ start: 0, end: 1, text: "脚本兜底" }], language: "zh" };
const request = (audio_path: string) => ({ audio_path, model: "tiny", language: "ja" });
function client(options: ConstructorParameters<typeof WhisperClient>[0] = {}, mode = "normal") {
  const children: ChildProcessWithoutNullStreams[] = [];
  const models: string[] = [];
  let fallbackCount = 0;
  const service = new WhisperClient({
    timeoutMs: 3000, startupTimeoutMs: 1500, queueTimeoutMs: 2000,
    spawnWorker(model) {
      models.push(model);
      const child = spawn(process.execPath, [fixture, mode], { stdio: ["pipe", "pipe", "pipe"] });
      children.push(child);
      return child;
    },
    async fallback() { fallbackCount++; return fallbackResult; },
    ...options,
  });
  return { service, children, models, fallbacks: () => fallbackCount };
}
const code = (expected: string) => (error: unknown) => error instanceof WhisperFailure && error.code === expected;

test("正常握手、同步响应、模型/语言和常驻复用", async () => {
  const previous = process.env.WHISPER_MODEL;
  process.env.WHISPER_MODEL = "";
  const state = client({ defaultModel: "" });
  try {
    assert.equal((await state.service.transcribe(request("normal"))).language, "ja");
    assert.equal((await state.service.transcribe(request("next"))).text, "next 中文🚀");
    assert.equal(state.children.length, 1);
    assert.deepEqual(state.models, ["medium"]);
    assert.equal(state.fallbacks(), 0);
  } finally {
    await state.service.close();
    if (previous === undefined) delete process.env.WHISPER_MODEL;
    else process.env.WHISPER_MODEL = previous;
  }
});

test("stdout 多字节分片保留中文和 emoji", async () => {
  const { service } = client();
  try { assert.equal((await service.transcribe(request("utf8"))).text, "utf8 中文🚀"); }
  finally { await service.close(); }
});

test("错误 ID、重复和迟到结果不污染下一请求", async () => {
  const { service } = client();
  try {
    assert.equal((await service.transcribe(request("wrong-id"))).text, "wrong-id 中文🚀");
    assert.equal((await service.transcribe(request("duplicate"))).text, "duplicate 中文🚀");
    assert.equal((await service.transcribe(request("normal"))).text, "normal 中文🚀");
  } finally { await service.close(); }
});

test("进度只接受 0—100 数字，回调抛错不拖挂请求", async () => {
  const { service } = client();
  const values: number[] = [];
  try {
    await service.transcribe(request("progress"), (value) => { values.push(value); throw new Error("UI callback"); });
    assert.deepEqual(values, [25, 100]);
  } finally { await service.close(); }
});

test("持续消费 stderr，不因日志管道填满而卡住", async () => {
  const { service } = client();
  try { assert.equal((await service.transcribe(request("stderr"))).text, "stderr 中文🚀"); }
  finally { await service.close(); }
});

for (const [mode, title] of [["silent-start", "启动无握手"], ["crash-start", "启动即退出"], ["old-protocol", "旧协议握手"]]) {
  test(`${title}：退出后在剩余预算内兜底一次`, async () => {
    const state = client({ startupTimeoutMs: 250, fallback: async () => {
      assert.ok(state.children.every((child) => child.exitCode !== null || child.signalCode !== null));
      return fallbackResult;
    } }, mode);
    try { assert.deepEqual(await state.service.transcribe(request("normal")), fallbackResult); }
    finally { await state.service.close(); }
  });
}

for (const action of ["crash", "bad-json", "oversize", "invalid-segment", "error"]) {
  test(`${action}：在途失败不挂起，下一排队请求重新建立常驻进程`, async () => {
    const state = client();
    try {
      const first = state.service.transcribe(request(action));
      const second = state.service.transcribe(request("normal"));
      assert.deepEqual(await first, fallbackResult);
      assert.equal((await second).text, "normal 中文🚀");
      assert.equal(state.fallbacks(), 1);
      assert.equal(state.children.length, 2);
    } finally { await state.service.close(); }
  });
}

test("真实 Python 关闭 stdout 但不退出时，收尾并恢复下一请求", async () => {
  let generations = 0;
  const state = client({ spawnWorker() {
    generations++;
    return generations === 1
      ? spawn("python", ["-B", path.join(process.cwd(), "tests", "fixtures", "whisper-output-close.py")], { stdio: ["pipe", "pipe", "pipe"] })
      : spawn(process.execPath, [fixture, "normal"], { stdio: ["pipe", "pipe", "pipe"] });
  } });
  try {
    const first = state.service.transcribe(request("normal"));
    const second = state.service.transcribe(request("normal"));
    assert.deepEqual(await first, fallbackResult);
    assert.equal((await second).text, "normal 中文🚀");
    assert.equal(generations, 2);
  } finally { await state.service.close(); }
});

test("spawn 同步失败与异步 ENOENT 均可兜底，不产生未处理 error", async () => {
  for (const spawnWorker of [() => { throw new Error("spawn failed"); }, () => spawn("vidsnap-nonexistent-test-command", [], { stdio: ["pipe", "pipe", "pipe"] })]) {
    const state = client({ spawnWorker });
    try { assert.deepEqual(await state.service.transcribe(request("normal")), fallbackResult); }
    finally { await state.service.close(); }
  }
});

test("在途超时与持续进度不续期，不额外启动脚本，后续仍能恢复", async () => {
  for (const action of ["hang", "forever-progress"]) {
    const state = client({ timeoutMs: 600 });
    try {
      await assert.rejects(state.service.transcribe(request(action)), code("timeout"));
      assert.equal(state.fallbacks(), 0);
      assert.equal((await state.service.transcribe(request("normal"))).text, "normal 中文🚀");
    } finally { await state.service.close(); }
  }
});

test("队列满明确拒绝，排队超时不转成并行脚本", async () => {
  const state = client({ timeoutMs: 2000, maxQueue: 1, queueTimeoutMs: 150 });
  try {
    await state.service.transcribe(request("normal"));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const active = assert.rejects(state.service.transcribe(request("hang"), started), code("closed"));
    await ready;
    const waiting = assert.rejects(state.service.transcribe(request("waiting")), code("queue_timeout"));
    await assert.rejects(state.service.transcribe(request("overflow")), code("capacity"));
    await waiting;
    assert.equal(state.fallbacks(), 0);
    await state.service.close();
    await active;
  } finally { await state.service.close(); }
});

test("兜底占用同一执行槽，下一任务不会并行启动常驻模型", async () => {
  let release!: (value: WhisperTranscript) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const state = client({ fallback: async () => { started(); return new Promise((resolve) => { release = resolve; }); } });
  try {
    const first = state.service.transcribe(request("crash"));
    const second = state.service.transcribe(request("normal"));
    await ready;
    assert.equal(state.children.length, 1);
    release(fallbackResult);
    await first;
    assert.equal((await second).text, "normal 中文🚀");
    assert.equal(state.children.length, 2);
  } finally { await state.service.close(); }
});

test("关闭时拒绝在途与排队请求，后续请求明确失败", async () => {
  const state = client();
  await state.service.transcribe(request("normal"));
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const first = assert.rejects(state.service.transcribe(request("hang"), started), code("closed"));
  await ready;
  const second = assert.rejects(state.service.transcribe(request("next")), code("closed"));
  await state.service.close();
  await Promise.all([first, second]);
  await assert.rejects(state.service.transcribe(request("after-close")), code("closed"));
});

test("单次脚本沿用剩余预算，排队及握手耗时不会重置总预算", async () => {
  let remaining = 0;
  const state = client({ timeoutMs: 1000, startupTimeoutMs: 200, fallback: async (_, timeout) => { remaining = timeout; return fallbackResult; } }, "silent-start");
  try {
    await state.service.transcribe(request("normal"));
    assert.ok(remaining > 0 && remaining < 850, `remaining=${remaining}`);
  } finally { await state.service.close(); }
});

test("结果校验允许无语音空片段，拒绝无效数字/倒序/错类型", () => {
  assert.deepEqual(parseWhisperTranscript({ text: "", segments: [] }), { text: "", segments: [], language: undefined });
  for (const value of [null, { text: 1, segments: [] }, { text: "", segments: [{ start: NaN, end: 1, text: "x" }] },
    { text: "", segments: [{ start: 2, end: 1, text: "x" }] }, { text: "", segments: [], language: 3 }]) {
    assert.throws(() => parseWhisperTranscript(value), code("protocol"));
  }
});

test("stdin 写回调及 stderr 管道失败会结束在途等待，再串行兜底", async () => {
  const state = client();
  try {
    await state.service.transcribe(request("normal"));
    Object.defineProperty(state.children[0].stdin, "write", {
      value: (_chunk: unknown, callback: (error: Error) => void) => { callback(new Error("fixture EPIPE")); return false; },
    });
    assert.deepEqual(await state.service.transcribe(request("normal")), fallbackResult);
    assert.equal(state.fallbacks(), 1);
    await state.service.transcribe(request("normal"));
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const pending = state.service.transcribe(request("hang"), started);
    await ready;
    state.children.at(-1)!.stderr.emit("error", new Error("fixture stderr failure"));
    assert.deepEqual(await pending, fallbackResult);
    assert.equal(state.fallbacks(), 2);
  } finally { await state.service.close(); }
});

test("未确认旧进程退出时，不启动兜底或新模型", async () => {
  const state = client({ timeoutMs: 600 });
  let originalKill: ChildProcessWithoutNullStreams["kill"] | undefined;
  try {
    await state.service.transcribe(request("normal"));
    originalKill = state.children[0].kill;
    Object.defineProperty(state.children[0], "kill", { value: () => false, configurable: true });
    await assert.rejects(state.service.transcribe(request("hang")), code("closed"));
    assert.equal(state.children.length, 1);
    assert.equal(state.fallbacks(), 0);
  } finally {
    if (originalKill) Object.defineProperty(state.children[0], "kill", { value: originalKill, configurable: true });
    await state.service.close();
  }
});
