import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareEvidenceReview, summarizeEvidenceReview } from "../src/lib/evidence-review";
import type { AnalysisResult } from "../src/lib/learning-types";

const sample: AnalysisResult = {
  analysisId: "11111111-1111-4111-8111-111111111111", platform: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  expiresAt: 1, video: { id: "dQw4w9WgXcQ", title: "测试", duration: 60, thumbnail: "", uploader: "测试" },
  transcriptSource: "builtin", transcription: { provider: "builtin", timing: "estimated" },
  vision: { outcome: "disabled", describedFrames: 0, totalFrames: 0 }, transcriptText: "不支持，价格是7元",
  transcriptSegments: [{ start: 10, end: 20, text: "不支持，价格是7元" }], frames: [],
  result: { overall: "价格介绍", segments: [{ title: "价格", start: 0, end: 30, points: [{ time: "00:10", text: "支持，价格是17元" }] }] },
};

test("默认保留全部要点并标为未审核，不推断事实", () => {
  const sheet = prepareEvidenceReview(sample);
  assert.deepEqual(sheet.claims[1].candidates, ["t0"]);
  const result = summarizeEvidenceReview(sample, sheet);
  assert.equal(result.counts.unreviewed, 2);
  assert.equal(result.supportedAmongReviewed, null);
  assert.equal(result.complete, false);
});

test("人工识别否定与数字矛盾，保留依据不足与真实分母", () => {
  const sheet = prepareEvidenceReview(sample);
  sheet.claims[0].review = { verdict: "insufficient", evidenceIds: [], reason: "内容不足以确认整体结论" };
  sheet.claims[1].review = { verdict: "contradicted", evidenceIds: ["t0"], reason: "原文为不支持且价格7元" };
  const report = summarizeEvidenceReview(sample, sheet);
  assert.equal(report.complete, true);
  assert.equal(report.counts.contradicted, 1);
  assert.equal(report.counts.insufficient, 1);
  assert.equal(report.supportedAmongReviewed, 0);
  assert.ok(!JSON.stringify(report).includes("价格"));
});

test("拒绝删改要点、证据、无依据的判断、重复引用和变化的输入", () => {
  const sheet = prepareEvidenceReview(sample);
  const missing = structuredClone(sheet); missing.claims.pop();
  const changed = structuredClone(sheet); changed.sources[0].text = "支持";
  const invalid = structuredClone(sheet); invalid.claims[1].review = { verdict: "supported", reason: "错误", evidenceIds: [] };
  const duplicate = structuredClone(sheet); duplicate.claims[1].review = { verdict: "contradicted", reason: "矛盾", evidenceIds: ["t0", "t0"] };
  for (const item of [missing, changed, invalid, duplicate]) assert.throws(() => summarizeEvidenceReview(sample, item));
  const malformed = structuredClone(sheet);
  Object.assign(malformed.claims[1].review, { verdict: ["supported"], reason: "错误类型", evidenceIds: ["t0"] });
  assert.throws(() => summarizeEvidenceReview(sample, malformed));
  const newer = structuredClone(sample); newer.transcriptSegments[0].text = "改变";
  assert.throws(() => summarizeEvidenceReview(newer, sheet));
  const retimed = structuredClone(sample); retimed.result.segments[0].points[0].time = "00:11";
  assert.throws(() => summarizeEvidenceReview(retimed, sheet));
});

test("CLI 准备、人工核查、报告及防覆盖", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "vidsnap-review-test-"));
  const input = path.join(directory, "input.json"), output = path.join(directory, "review.json");
  const run = (mode: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/evidence-review.ts", mode, input, output], { encoding: "utf8", timeout: 15000 });
  try {
    await writeFile(input, JSON.stringify(sample));
    assert.equal(run("prepare").status, 0);
    assert.equal(run("prepare").status, 2);
    assert.equal(run("report").status, 1);
    const sheets = JSON.parse(await readFile(output, "utf8"));
    sheets[0].claims[0].review = { verdict: "supported", reason: "依据原文", evidenceIds: ["t0"] };
    sheets[0].claims[1].review = { verdict: "contradicted", reason: "否定及价格不同", evidenceIds: ["t0"] };
    await writeFile(output, JSON.stringify(sheets));
    const report = run("report");
    assert.equal(report.status, 1);
    assert.equal(JSON.parse(report.stdout).reports[0].counts.contradicted, 1);
    assert.ok(!report.stdout.includes("价格"));
    sheets[0].claims[1].review = { verdict: "supported", reason: "人工判定", evidenceIds: ["t0"] };
    await writeFile(output, JSON.stringify(sheets));
    assert.equal(run("report").status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
