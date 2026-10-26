import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPipeline, localAcceptanceUrl, timingSummary } from "../scripts/pipeline-acceptance";

const base = "http://127.0.0.1:3419";
const id = "c05ae8fa-118a-4010-a926-b2168eab27a2";
const headers = { "x-vidsnap-live-acceptance": "text-only" };
const timings = { stages: { metadata: { ms: 5, outcome: "completed" } }, firstTokenMs: 10, summaryReadyMs: 20, resultReadyMs: 25 };

function tape(failure = "") {
  const requests: { url: string; method: string }[] = [];
  let processes = 0;
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, method: options?.method ?? "GET" });
    if (url === base) return new Response("", { headers });
    if (url.endsWith("/api/verify")) return Response.json({ success: true }, { headers: { ...headers, "set-cookie": "vidsnap-session=private-session; HttpOnly" } });
    if (url.endsWith("/api/process") && options?.method === "DELETE") return Response.json({ success: true }, { headers });
    if (url.endsWith("/api/process")) {
      const cached = processes++ > 0;
      const events = [{ type: "progress", analysisId: id }, ...(failure === "process" ? [{ type: "error", message: "private-upstream-error" }] : [
        ...(cached ? [] : [{ type: "stream", text: "private-stream" }]),
        { type: "result", data: { analysisId: id, video: { id: "jNQXAC9IVRw", duration: 19 }, cached,
          transcriptSource: "builtin", transcriptSegments: [{ start: 0, end: 1, text: "private-subtitle" }], result: { overall: "private-summary" },
          metrics: { totalMs: 30, private_key: "private-key", timings: { ...timings, ...(cached ? { firstTokenMs: null, summaryReadyMs: null } : {}) } } } },
      ])];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers });
    }
    const afterDelete = requests.some((request) => request.method === "DELETE");
    return Response.json({ success: true, answer: "private-answer", retrievalSource: "full", toolsUsed: [] }, { status: afterDelete ? 404 : failure === "followup" ? 503 : 200, headers });
  };
  return { fetcher, requests };
}

test("真实验收只允许专用环回端口，拒绝生产默认端口、远端和重定向参数", () => {
  assert.equal(localAcceptanceUrl(base), base);
  for (const value of ["https://example.com", "http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:80", "http://localhost:3419", `${base}/api`, `${base}?next=private`, "http://user:secret@127.0.0.1:3419"]) {
    assert.throws(() => localAcceptanceUrl(value));
  }
});

test("计时报告只选定已知有限数值，未知或敏感字段不会进入报告", () => {
  const result = timingSummary({ totalMs: 30, private_key: "secret", timings: { ...timings, secret: "secret", stages: { ...timings.stages, inflight_wait: { ms: 15, outcome: "completed" }, private: { content: "secret" } } } });
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  assert.deepEqual(result.stages.inflight_wait, { ms: 15, outcome: "completed" });
  for (const invalid of [{}, { totalMs: NaN, timings }, { totalMs: 30, timings: { ...timings, resultReadyMs: -1 } },
    { totalMs: 30, timings: { ...timings, stages: { metadata: { ms: 1, outcome: "private-error" } } } }]) assert.throws(() => timingSummary(invalid));
});

test("缺少 live 标记或加载替身的服务在任何写请求前停止", async () => {
  for (const responseHeaders of [{}, { ...headers, "x-vidsnap-test-mocks": "1" }]) {
    let count = 0;
    const fetcher: typeof fetch = async (_input, options) => {
      count++;
      assert.equal(options?.method, undefined);
      return new Response("", { headers: responseHeaders });
    };
    const report = await checkPipeline(base, "private-access-code", fetcher);
    assert.equal(count, 1);
    assert.equal(report.text_api_pipeline_verified, false);
  }
});

test("真实流程检查器覆盖门禁、处理、追问、缓存、删除和删除后拒绝，报告不含正文或凭据", async () => {
  const fixture = tape();
  const report = await checkPipeline(base, "private-access-code", fixture.fetcher);
  assert.equal(report.text_api_pipeline_verified, true);
  assert.equal(report.full_pipeline_verified, false);
  assert.equal(fixture.requests.length, 7);
  assert.equal(report.checks.every((check) => check.status === "pass"), true);
  assert.doesNotMatch(JSON.stringify(report), /private/);
});

test("处理中途错误和追问失败仍只删除本次分析，不输出原始异常", async () => {
  for (const failure of ["process", "followup"]) {
    const fixture = tape(failure);
    const report = await checkPipeline(base, "private-code", fixture.fetcher);
    assert.equal(report.text_api_pipeline_verified, false);
    assert.equal(fixture.requests.at(-1)?.method, "DELETE");
    assert.equal(report.checks.at(-1)?.id, "failure_cleanup");
    assert.equal(report.checks.at(-1)?.status, "pass");
    assert.doesNotMatch(JSON.stringify(report), /private/);
  }
});
