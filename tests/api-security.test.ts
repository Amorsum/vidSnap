import assert from "node:assert/strict";
import { before, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest } from "next/server";

// tsx 不加载 .env.local；测试专用访问码和独立 IP 桶不消耗服务进程额度。
const testCode = "security-regression-only";
let main: typeof import("../src/app/api/process/route");
let summarize: typeof import("../src/app/api/process/summarize/route");
let transcribe: typeof import("../src/app/api/process/transcribe/route");
let followup: typeof import("../src/app/api/followup/route");
let verify: typeof import("../src/app/api/verify/route");
let sequence = 0;

before(async () => {
  process.env.ACCESS_CODE = testCode;
  main = await import("../src/app/api/process/route");
  summarize = await import("../src/app/api/process/summarize/route");
  transcribe = await import("../src/app/api/process/transcribe/route");
  followup = await import("../src/app/api/followup/route");
  verify = await import("../src/app/api/verify/route");
});

function request(body: unknown, options: { code?: string; ip?: string; raw?: boolean; method?: string } = {}) {
  return new NextRequest("http://localhost/api/test", {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": options.code ?? testCode,
      "cf-connecting-ip": options.ip ?? `test-security-${++sequence}`,
    },
    body: options.raw ? String(body) : JSON.stringify(body),
  });
}

for (const name of ["main", "summarize", "transcribe", "followup", "delete"] as const) {
  test(`${name}：鉴权先于 JSON 解析和处理`, async () => {
    const handler = { main: main.POST, summarize: summarize.POST, transcribe: transcribe.POST, followup: followup.POST, delete: main.DELETE }[name];
    for (const code of ["", "wrong-code"]) {
      const response = await handler(request("{", { code, raw: true, method: name === "delete" ? "DELETE" : "POST" }));
      assert.equal(response.status, 401);
      assert.match((await response.json()).error, /访问码/);
    }
  });
}

for (const name of ["main", "summarize", "transcribe", "followup", "delete", "verify"] as const) {
  test(`${name}：坏 JSON、null、数组和基础类型返回 400`, async () => {
    const handler = { main: main.POST, summarize: summarize.POST, transcribe: transcribe.POST, followup: followup.POST, delete: main.DELETE, verify: verify.POST }[name];
    for (const raw of ["{", "null", "[]", '"text"', "123"]) {
      const response = await handler(request(raw, { raw: true, method: name === "delete" ? "DELETE" : "POST" }));
      assert.equal(response.status, 400, `${name} ${raw}`);
    }
  });
}

test("三个处理入口拒绝错型和伪造域名，不进入媒体下载", async () => {
  for (const handler of [main.POST, summarize.POST, transcribe.POST]) {
    for (const url of [{}, [], 123, "https://evil.example/?next=https://youtube.com/watch?v=dQw4w9WgXcQ"]) {
      assert.equal((await handler(request({ url }))).status, 400);
    }
  }
});

test("历史总结接口只接受枚举模式", async () => {
  for (const mode of [null, {}, [], 123, "unknown"]) {
    const response = await summarize.POST(request({ url: "https://youtu.be/dQw4w9WgXcQ", mode }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /模式/);
  }
});

test("三个处理入口共享 10 次配额，401 不消耗配额，429 包含 Retry-After", async () => {
  const ip = "test-security-shared-process";
  const handlers = [main.POST, summarize.POST, transcribe.POST];
  for (const handler of handlers) {
    assert.equal((await handler(request({}, { code: "wrong", ip }))).status, 401);
  }
  for (let i = 0; i < 10; i++) {
    assert.equal((await handlers[i % handlers.length](request({}, { ip }))).status, 400);
  }
  for (const handler of handlers) {
    const response = await handler(request({}, { ip }));
    assert.equal(response.status, 429);
    const retryAfter = Number(response.headers.get("Retry-After"));
    assert.ok(retryAfter > 0 && retryAfter <= 600);
  }
});

test("追问与删除分别保留独立限流桶", async () => {
  const ip = "test-security-other-buckets";
  for (let i = 0; i < 30; i++) {
    assert.equal((await followup.POST(request({}, { ip }))).status, 400);
  }
  const response = await followup.POST(request({}, { ip }));
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.equal((await main.DELETE(request({}, { ip, method: "DELETE" }))).status, 400);
  assert.equal((await main.POST(request({}, { ip }))).status, 400);
});

test("删除拒绝非字符串 ID、空 ID 和路径字符", async () => {
  for (const videoId of [[], {}, 123, "", "../", "a/b", "a\\b", "a".repeat(65)]) {
    assert.equal((await main.DELETE(request({ videoId }, { method: "DELETE" }))).status, 400);
  }
});

test("追问拒绝非法问题和 ID；合法但不存在的 ID 返回 404", async () => {
  for (const question of [[], {}, 12, "", "   ", "a".repeat(4001)]) {
    assert.equal((await followup.POST(request({ videoId: "missing", question }))).status, 400);
  }
  assert.equal((await followup.POST(request({ videoId: {}, question: "问题" }))).status, 400);
  const response = await followup.POST(request({ videoId: "test-missing", question: "问题" }));
  assert.equal(response.status, 404);
});

test("verify 拒绝错型访问码，正确访问码不占失败桶", async () => {
  for (const code of [null, {}, [], 123, "a".repeat(4097)]) {
    assert.equal((await verify.POST(request({ code }))).status, 400);
  }
  const ip = "test-security-verify";
  for (let i = 0; i < 10; i++) {
    assert.equal((await verify.POST(request({ code: "wrong" }, { ip }))).status, 401);
  }
  const denied = await verify.POST(request({ code: "wrong" }, { ip }));
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("Retry-After")) > 0);
  assert.equal((await verify.POST(request({ code: testCode }, { ip }))).status, 200);
});

test("未配置访问码时仍兼容放行，限流继续生效", async () => {
  const script = `
    const assert = require('node:assert/strict');
    const { verifyAccessCode, guardApiRequest } = require('./src/lib/security.ts');
    assert.equal(verifyAccessCode(null), true);
    const request = new Request('http://localhost', { headers: { 'cf-connecting-ip': 'test-no-gate' } });
    for (let i = 0; i < 10; i++) assert.equal(guardApiRequest(request, 'process'), null);
    assert.equal(guardApiRequest(request, 'process').status, 429);
  `;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "-e", script], {
    env: { ...process.env, ACCESS_CODE: "" },
    timeout: 15000,
  });
});
