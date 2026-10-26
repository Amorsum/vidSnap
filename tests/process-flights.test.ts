import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessFlights } from "../src/lib/process-flights";
import { ServiceCapacityError } from "../src/lib/request-validation";
import { parseVideoUrl } from "../src/lib/url-utils";

const video = parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")!;
const ready = { analysisId: "analysis-a", videoId: "dQw4w9WgXcQ" };
const signal = () => new AbortController().signal;
const ignore = () => {};

test("规范链接合并仅在同会话同平台，容量满时仍允许加入已有执行", async () => {
  const flights = new ProcessFlights(1);
  const leader = flights.acquire("owner-a", video);
  assert.ok(leader.leader);
  assert.throws(() => flights.acquire("owner-b", video), ServiceCapacityError);
  assert.throws(() => flights.acquire("owner-a", { ...video, platform: "douyin" }), ServiceCapacityError);
  const joined = flights.acquire("owner-a", parseVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")!);
  assert.ok(!joined.leader);
  const pending = joined.wait(ignore, signal());
  leader.finish(ready);
  assert.deepEqual(await pending, ready);
  const next = flights.acquire("owner-b", video);
  assert.ok(next.leader);
  next.finish(ready);
});

test("只保留最新进度及分析身份，不转发流片段、正文或任意字段", async () => {
  const flights = new ProcessFlights();
  const leader = flights.acquire("a", video);
  assert.ok(leader.leader);
  leader.publish({ type: "progress", analysisId: "id", step: "downloading", percent: 10, secret: "private" });
  leader.publish({ type: "progress", step: "analyzing", percent: 75 });
  leader.publish({ type: "stream", text: "private" });
  const joined = flights.acquire("a", video);
  assert.ok(!joined.leader);
  const events: unknown[] = [];
  const pending = joined.wait((event) => events.push(event), signal());
  assert.deepEqual(events, [{ type: "progress", analysisId: "id", step: "analyzing", percent: 75 }]);
  leader.finish(ready);
  await pending;
});

test("失败广播并释放执行键，未订阅完成的等待者也能安全读取结果", async () => {
  const flights = new ProcessFlights();
  const leader = flights.acquire("a", video);
  const joined = flights.acquire("a", video);
  assert.ok(leader.leader && !joined.leader);
  const pending = joined.wait(ignore, signal());
  leader.finish({ error: "safe error" });
  assert.deepEqual(await pending, { error: "safe error" });
  assert.deepEqual(await joined.wait(ignore, signal()), { error: "safe error" });
  const retry = flights.acquire("a", video);
  assert.ok(retry.leader);
  retry.finish(ready);
});

test("等待者数量受限，取消立即释放名额且不结束执行", async () => {
  const flights = new ProcessFlights(1, 1);
  const leader = flights.acquire("a", video);
  const joined = flights.acquire("a", video);
  assert.ok(leader.leader && !joined.leader);
  const controller = new AbortController();
  const pending = joined.wait(ignore, controller.signal);
  assert.throws(() => joined.wait(ignore, signal()), ServiceCapacityError);
  controller.abort();
  assert.deepEqual(await pending, { error: "连接已断开" });
  const next = joined.wait(ignore, signal());
  leader.finish(ready);
  assert.deepEqual(await next, ready);
});

test("已断连的等待者不占名额、不触发进度回调", async () => {
  const flights = new ProcessFlights(1, 1);
  const leader = flights.acquire("a", video);
  const joined = flights.acquire("a", video);
  assert.ok(leader.leader && !joined.leader);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await joined.wait(() => assert.fail("不能回调已断开的连接"), controller.signal), { error: "连接已断开" });
  const pending = joined.wait(ignore, signal());
  leader.finish(ready);
  assert.deepEqual(await pending, ready);
});

test("等待超时只移除订阅，不允许重入重复执行", async () => {
  const flights = new ProcessFlights(1, 1, 1);
  const leader = flights.acquire("a", video);
  const joined = flights.acquire("a", video);
  assert.ok(leader.leader && !joined.leader);
  const pending = joined.wait(ignore, signal());
  await delay(10);
  assert.deepEqual(await pending, { error: "等待同视频处理超时，请稍后重试" });
  const stillJoined = flights.acquire("a", video);
  assert.ok(!stillJoined.leader);
  const retried = stillJoined.wait(ignore, signal());
  leader.finish(ready);
  assert.deepEqual(await retried, ready);
});

test("删除立即终止等待，旧执行 finish 不得移除替代执行或改写结局", async () => {
  const flights = new ProcessFlights();
  const leader = flights.acquire("a", video);
  const joined = flights.acquire("a", video);
  assert.ok(leader.leader && !joined.leader);
  leader.publish({ type: "progress", analysisId: ready.analysisId, step: "analyzing", percent: 75 });
  const pending = joined.wait(ignore, signal());
  flights.revoke(ready.analysisId);
  const revoked = await pending;
  assert.ok("error" in revoked);
  assert.match(revoked.error, /已删除或过期/);
  const replacement = flights.acquire("a", video);
  assert.ok(replacement.leader);
  leader.finish(ready);
  const follower = flights.acquire("a", video);
  assert.ok(!follower.leader);
  const fresh = follower.wait(ignore, signal());
  replacement.finish({ ...ready, analysisId: "analysis-b" });
  assert.deepEqual(await fresh, { ...ready, analysisId: "analysis-b" });
});

test("不同抖音短码不提前假定为同视频，仅相同规范短链合并", () => {
  const flights = new ProcessFlights();
  const a = flights.acquire("a", parseVideoUrl("https://v.douyin.com/shortA")!);
  const b = flights.acquire("a", parseVideoUrl("https://v.douyin.com/shortB")!);
  assert.ok(a.leader && b.leader);
  assert.ok(!flights.acquire("a", parseVideoUrl("https://v.douyin.com/shortA/")!).leader);
  a.finish(ready);
  b.finish(ready);
});
