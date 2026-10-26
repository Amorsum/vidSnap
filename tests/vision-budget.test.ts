import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VisionBudget, VisionBudgetExceeded, visionTimeoutMs } from "../src/lib/vision-budget";
import { describeFrames } from "../src/lib/vision";
import type { Keyframe } from "../src/lib/keyframes";

const originalFetch = globalThis.fetch;
const previousKey = process.env.SENSEVOICE_API_KEY;
let directory: string;
let frames: Keyframe[];

before(async () => {
  process.env.SENSEVOICE_API_KEY = "test-vision-only";
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-vision-budget-"));
  frames = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const file = path.join(directory, `${index}.jpg`);
    await fs.writeFile(file, "fixture");
    return { frameId: index + 1, time: index * 3, path: file };
  }));
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.SENSEVOICE_API_KEY;
  else process.env.SENSEVOICE_API_KEY = previousKey;
  await Promise.all(frames.map((frame) => fs.unlink(frame.path)));
  await fs.rmdir(directory);
});

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
function reply(ids: number[], content?: string) {
  return Response.json({ choices: [{ message: { content: content ?? JSON.stringify({ frames: ids.map((frameId) => ({ frameId, time: 999, description: `frame ${frameId}` })) }) } }], usage });
}

test("视觉总预算默认 30 秒，仅接受 1000—120000 毫秒整数配置", () => {
  const previous = process.env.VISION_TIMEOUT_MS;
  try {
    delete process.env.VISION_TIMEOUT_MS;
    assert.equal(visionTimeoutMs(), 30000);
    for (const value of ["", "NaN", "999", "120001", "1000.5", "-1000", "Infinity"]) {
      process.env.VISION_TIMEOUT_MS = value;
      assert.equal(visionTimeoutMs(), 30000);
    }
    for (const value of ["1000", "30000", "120000"]) {
      process.env.VISION_TIMEOUT_MS = value;
      assert.equal(visionTimeoutMs(), Number(value));
    }
  } finally {
    if (previous === undefined) delete process.env.VISION_TIMEOUT_MS;
    else process.env.VISION_TIMEOUT_MS = previous;
  }
});

test("单调截止时间不因分批重置，晚到结果不得越过期限", async () => {
  let now = 0;
  const budget = new VisionBudget(100, () => now);
  now = 40;
  assert.equal(budget.remainingMs(), 60);
  assert.equal(await budget.run(async () => { now = 75; return "first"; }), "first");
  assert.equal(budget.remainingMs(), 25);
  await assert.rejects(budget.run(async () => { now = 101; return "late"; }), VisionBudgetExceeded);
  assert.equal(budget.exhausted, true);
  await assert.rejects(budget.run(async () => assert.fail("到期后不能启动新操作")), VisionBudgetExceeded);
});

test("预算到期会取消进行中的 HTTP 等待，不依赖上游自行报错", async () => {
  const budget = new VisionBudget(30);
  let aborted = false;
  await assert.rejects(budget.run((signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
  })), VisionBudgetExceeded);
  assert.equal(aborted, true);
});

test("批次中途耗尽预算保留已成功的 4 帧和 usage，不启动备用模型", async () => {
  let now = 0;
  let requests = 0;
  const budget = new VisionBudget(1000, () => now);
  globalThis.fetch = async () => {
    requests++;
    if (requests === 2) { now = 1001; return reply([5, 6, 7, 8]); }
    return reply([4, 3, 2, 1]);
  };
  const result = await describeFrames(frames, "fixture", budget);
  assert.equal(requests, 2);
  assert.equal(result?.outcome, "budget_exhausted");
  assert.deepEqual(result?.descriptions.map((frame) => [frame.frameId, frame.time]), frames.slice(0, 4).map((frame) => [frame.frameId, frame.time]));
  assert.equal(result?.usage?.totalTokens, 15);
  assert.equal(result?.usageComplete, false);
});

test("响应头成功但正文挂起仍受预算约束，晚到正文不触发补帧或恢复结果", { timeout: 5000 }, async () => {
  let requests = 0;
  let signal: AbortSignal | null | undefined;
  let completeBody: (value: unknown) => void = () => {};
  const started = new Promise<void>((resolve) => {
    globalThis.fetch = async (_input, options) => {
      requests++;
      signal = options?.signal;
      const response = reply([1]);
      Object.defineProperty(response, "json", { value: () => new Promise((done) => { completeBody = done; resolve(); }) });
      return response;
    };
  });
  const pending = describeFrames(frames.slice(0, 1), "fixture", new VisionBudget(500));
  await started;
  const result = await pending;
  assert.equal(result?.outcome, "budget_exhausted");
  assert.deepEqual(result?.descriptions, []);
  assert.equal(result?.usage, null);
  assert.equal(signal?.aborted, true);
  completeBody({ choices: [{ message: { content: '{"frames":[{"frameId":1,"description":"late"}]}' } }], usage });
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.deepEqual(result?.descriptions, []);
});

test("剩余预算不能容纳退避时不重试或遍历备用模型", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({}, { status: 503 }); };
  const result = await describeFrames(frames.slice(0, 1), "fixture", new VisionBudget(1000, () => 0));
  assert.equal(requests, 1);
  assert.equal(result?.outcome, "budget_exhausted");
  assert.equal(result?.usage, null);
});

test("全部描述格式失败仍保留已返回的实际 usage，不把费用记成缺失", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return reply([], "invalid JSON"); };
  const result = await describeFrames(frames.slice(0, 1), "fixture");
  assert.equal(requests, 3);
  assert.equal(result?.outcome, "failed");
  assert.deepEqual(result?.descriptions, []);
  assert.equal(result?.usage?.totalTokens, 45);
  assert.equal(result?.usageComplete, true);
});

test("部分批次缺少有效 usage 只累计可确认值，并标记总用量不完整", async () => {
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? reply([1, 2, 3, 4]) : Response.json({
    choices: [{ message: { content: '{"frames":[{"frameId":5,"description":"frame 5"}]}' } }],
    usage: { prompt_tokens: "10", completion_tokens: 5, total_tokens: 15 },
  });
  const result = await describeFrames(frames.slice(0, 5), "fixture");
  assert.equal(result?.outcome, "completed");
  assert.equal(result?.usage?.totalTokens, 15);
  assert.equal(result?.usageComplete, false);
});

test("短暂服务端失败在同一剩余预算和 signal 内至多重试一次", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  globalThis.fetch = async (_input, options) => {
    signals.push(options?.signal);
    return signals.length === 1 ? Response.json({}, { status: 503 }) : reply([1]);
  };
  const result = await describeFrames(frames.slice(0, 1), "fixture", new VisionBudget(10000));
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(result?.outcome, "completed");
  assert.equal(result?.usage?.totalTokens, 15);
  assert.equal(result?.usageComplete, false);
});

test("备用模型仅补缺失帧，顺序和模型的错误时间不会改变帧身份", async () => {
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? reply([2]) : reply([3, 1, 999]);
  const result = await describeFrames(frames.slice(0, 3), "fixture");
  assert.equal(requests, 2);
  assert.equal(result?.outcome, "completed");
  assert.deepEqual(result?.descriptions.map((frame) => [frame.frameId, frame.time]), frames.slice(0, 3).map((frame) => [frame.frameId, frame.time]));
  assert.equal(result?.usage?.totalTokens, 30);
});

test("无 key、无帧、预算已耗尽均不发送模型请求", async () => {
  const key = process.env.SENSEVOICE_API_KEY;
  globalThis.fetch = async () => assert.fail("不能发送模型请求");
  try {
    delete process.env.SENSEVOICE_API_KEY;
    assert.equal(await describeFrames(frames, "fixture"), null);
    process.env.SENSEVOICE_API_KEY = key;
    assert.equal(await describeFrames([], "fixture"), null);
    // 使用已到期的独立单调时钟，无需真实等待。
    let now = 0;
    const expired = new VisionBudget(10, () => now);
    now = 11;
    assert.equal((await describeFrames(frames, "fixture", expired))?.outcome, "budget_exhausted");
  } finally { process.env.SENSEVOICE_API_KEY = key; }
});
