import assert from "node:assert/strict";
import { test } from "node:test";
import { PipelineTimer } from "../src/lib/pipeline-timing";

test("阶段使用单调时钟记录实际耗时，返回业务结果", async () => {
  let now = 100;
  const timer = new PipelineTimer(() => now);
  const value = await timer.measure("metadata", () => { now += 25.4; return "info"; });
  assert.equal(value, "info");
  assert.deepEqual(timer.snapshot().stages, { metadata: { ms: 25, outcome: "completed" } });
  assert.equal(timer.elapsedMs(), 25);
});

test("失败阶段保留耗时并原样抛错，不产生结果就绪时间", async () => {
  let now = 0;
  const timer = new PipelineTimer(() => now);
  const error = new Error("original");
  await assert.rejects(timer.measure("download", async () => { now = 40; throw error; }), (caught) => caught === error);
  assert.deepEqual(timer.snapshot().stages.download, { ms: 40, outcome: "failed" });
  assert.equal(timer.snapshot().resultReadyMs, null);
});

test("同阶段重复查找只累计实际查找耗时，不计入中间的平台等待", async () => {
  let now = 0;
  const timer = new PipelineTimer(() => now);
  await timer.measure("cache_lookup", () => { now += 2; });
  now += 100;
  await timer.measure("cache_lookup", () => { now += 3; });
  assert.deepEqual(timer.snapshot().stages.cache_lookup, { ms: 5, outcome: "completed" });
  assert.equal(timer.elapsedMs(), 105);
});

test("可选能力失败可以记录降级，与未运行阶段区分", async () => {
  const timer = new PipelineTimer(() => 0);
  await timer.measure("embedding", () => undefined, (value) => value ? "completed" : "degraded");
  assert.equal(timer.snapshot().stages.embedding?.outcome, "degraded");
  assert.equal(timer.snapshot().stages.vision, undefined);
});

test("首片段、总结解析、结果就绪独立记录，零毫秒不被后续标记覆盖", () => {
  let now = 0;
  const timer = new PipelineTimer(() => now);
  timer.markFirstToken();
  now = 20;
  timer.markFirstToken();
  timer.markSummaryReady();
  now = 50;
  timer.markSummaryReady();
  timer.markResultReady();
  assert.deepEqual(timer.snapshot(), { stages: {}, firstTokenMs: 0, summaryReadyMs: 20, resultReadyMs: 50 });
});

test("快照不能反向修改计时器，也不继承上次缓存填充请求的阶段", async () => {
  const first = new PipelineTimer(() => 0);
  await first.measure("summary", () => 1);
  const snapshot = first.snapshot();
  snapshot.stages.summary!.ms = 100;
  assert.equal(first.snapshot().stages.summary?.ms, 0);
  const cached = new PipelineTimer(() => 0);
  await cached.measure("cache_restore", () => 1);
  cached.markResultReady();
  assert.deepEqual(cached.snapshot(), { stages: { cache_restore: { ms: 0, outcome: "completed" } }, firstTokenMs: null, summaryReadyMs: null, resultReadyMs: 0 });
});
