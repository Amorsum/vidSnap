import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { auditCitations } from "../src/lib/citation-audit";
import { normalizeSummaryCitations } from "../src/lib/summary-citations";
import type { AnalysisResult } from "../src/lib/learning-types";

function fixture(): AnalysisResult {
  return {
    analysisId: "11111111-1111-4111-8111-111111111111", platform: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    expiresAt: 1, video: { id: "dQw4w9WgXcQ", title: "合成样本", duration: 90, thumbnail: "", uploader: "测试" },
    transcriptSource: "builtin", transcription: { provider: "builtin", timing: "source" },
    vision: { outcome: "partial", describedFrames: 1, totalFrames: 2 }, transcriptText: "合成文字",
    transcriptSegments: [{ start: 10.8, end: 15, text: "不支持自动扣款" }],
    result: { overall: "合成总结", segments: [{ title: "章节", start: 10.8, end: 30, points: [{ time: "00:10", text: "支持自动扣款" }] }] },
    frames: [{ time: 25.5, description: "合成画面", src: "/api/frames?token=never-report" }],
  };
}

test("向下取整的原文时间可定位，但不冒充事实正确", () => {
  const report = auditCitations(fixture());
  assert.equal(report.flaggedPoints, 0);
  assert.deepEqual(report.chapters[0].points[0].transcriptIndexes, [0]);
  assert.equal(report.factualSupport, "not_evaluated");
  assert.ok(!JSON.stringify(report).includes("never-report"));
});

test("无效时间、视频越界、章节越界和证据空档分别报告", () => {
  for (const [time, expected] of [
    ["00:99", ["invalid_time"]], ["01:40", ["outside_video", "outside_chapter", "no_temporal_evidence"]],
    ["00:05", ["outside_chapter", "no_temporal_evidence"]], ["00:20", ["no_temporal_evidence"]],
  ] as const) {
    const analysis = fixture();
    analysis.result.segments[0].points[0].time = time;
    assert.deepEqual(auditCitations(analysis).chapters[0].points[0].issues, expected);
  }
});

test("画面可作为独立时间依据，空描述与空字幕不能冒充证据", () => {
  const analysis = fixture();
  analysis.result.segments[0].points[0].time = "00:25";
  assert.deepEqual(auditCitations(analysis).chapters[0].points[0].frameIndexes, [0]);
  analysis.frames[0].description = " ";
  assert.equal(auditCitations(analysis).flaggedPoints, 1);
  analysis.result.segments[0].points[0].time = "00:10";
  analysis.transcriptSegments[0].text = " ";
  assert.equal(auditCitations(analysis).flaggedPoints, 1);
});

test("估算时间保持标记，小时格式可解析，空总结与空章节越界不能漏报", () => {
  const analysis = fixture();
  analysis.transcription.timing = "estimated";
  assert.equal(auditCitations(analysis).transcriptionTiming, "estimated");
  analysis.video.duration = 4000;
  analysis.result.segments[0] = { title: "长视频", start: 3600, end: 3900, points: [{ time: "01:00:10", text: "长视频" }] };
  analysis.transcriptSegments = [{ start: 3610, end: 3620, text: "长视频" }];
  assert.equal(auditCitations(analysis).flaggedPoints, 0);
  analysis.result.segments[0].points = [];
  analysis.result.segments[0].end = 5000;
  assert.equal(auditCitations(analysis).emptySummary, true);
  assert.equal(auditCitations(analysis).flaggedChapters, 1);
});

test("估算长段仅保留字幕段起点和画面时间，越界或推测时间的正文仍在", () => {
  const analysis = fixture();
  analysis.video.duration = 51.873;
  analysis.transcriptSegments = [{ start: 0, end: 30.585, text: "前半段" }, { start: 30.585, end: 51.873, text: "后半段" }];
  analysis.result.segments = [{ start: 0, end: 55, title: "对话", points: ["00:00", "00:05", "00:25", "00:30", "00:55"].map(time => ({ time, text: `要点 ${time}` })) }];
  const normalized = normalizeSummaryCitations(analysis.result, analysis.video.duration, analysis.transcriptSegments, "estimated", analysis.frames);
  assert.equal(normalized.segments[0].end, 51.873);
  assert.deepEqual(normalized.segments[0].points.map(p => p.time), ["00:00", "", "00:25", "00:30", ""]);
  assert.deepEqual(normalized.segments[0].points.map(p => p.text), analysis.result.segments[0].points.map(p => p.text));
  assert.equal(analysis.result.segments[0].points.at(-1)?.time, "00:55");
  const report = auditCitations({ ...analysis, result: normalized });
  assert.equal(report.unlocatedPoints, 2);
  assert.equal(report.flaggedPoints, 0);
});

test("来源时间允许有效字幕范围内定位，拒绝无证据、章节越界和无效时间", () => {
  const analysis = fixture();
  const points = ["00:11", "00:16", "00:05", "00:99"].map(time => ({ time, text: time }));
  analysis.result.segments[0].points = points;
  assert.deepEqual(normalizeSummaryCitations(analysis.result, 90, analysis.transcriptSegments, "source").segments[0].points.map(p => p.time), ["00:11", "", "", ""]);
});

test("多条要点可复用同一段，服务端忽略模型秒数并拒绝不存在或不在章节的编号", () => {
  const analysis = fixture();
  analysis.transcriptSegments.push({ start: 12.4, end: 18, text: "重叠的另一段" });
  analysis.result.segments[0].points = ["t1", "t1", "f0", "t99", "t01"].map(evidenceId => ({ evidenceId, time: "99:00", text: evidenceId }));
  const result = normalizeSummaryCitations(analysis.result, 90, analysis.transcriptSegments, "estimated", analysis.frames);
  const points = result.segments[0].points;
  assert.deepEqual(points.map(point => point.time), ["00:12", "00:12", "00:25", "", ""]);
  assert.deepEqual(points.map(point => point.evidenceId), ["t1", "t1", "f0", undefined, undefined]);
  const report = auditCitations({ ...analysis, result });
  assert.deepEqual(report.chapters[0].points[0].transcriptIndexes, [1]);
  assert.deepEqual(report.chapters[0].points[2].frameIndexes, [0]);
  points[0].time = "00:10";
  assert.deepEqual(auditCitations({ ...analysis, result }).chapters[0].points[0].issues, ["invalid_evidence"]);
  analysis.result.segments[0].start = 14;
  assert.equal(normalizeSummaryCitations(analysis.result, 90, analysis.transcriptSegments, "estimated").segments[0].points[0].time, "");
});

test("命令行区分有效、待核查与坏输入，输出不泄漏正文和签名", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "vidsnap-citation-test-"));
  const input = path.join(directory, "analysis.json");
  const run = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/citation-audit.ts", input], { encoding: "utf8", timeout: 15000 });
  try {
    const analysis = fixture();
    await writeFile(input, JSON.stringify(analysis));
    const good = run();
    assert.equal(good.status, 0, good.stderr);
    assert.match(JSON.parse(good.stdout).inputSha256, /^[a-f0-9]{64}$/);
    assert.ok(!/never-report|自动扣款|合成样本/.test(good.stdout));
    const note = { id: "synthetic-note", version: 1, createdAt: 1, updatedAt: 1, lastViewedAt: 1, personalNote: "private-note", turns: [], analysis };
    await writeFile(input, JSON.stringify({ format: "vidsnap-notebook", version: 1, notes: [note, { ...note, id: "second" }] }));
    const backup = run();
    assert.equal(backup.status, 0, backup.stderr);
    assert.equal(JSON.parse(backup.stdout).reports.length, 2);
    assert.ok(!backup.stdout.includes("private-note"));
    analysis.result.segments[0].points[0].time = "invalid";
    await writeFile(input, JSON.stringify(analysis));
    assert.equal(run().status, 1);
    await writeFile(input, '{"secret":"never-report",');
    const bad = run();
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
    assert.ok(!bad.stderr.includes("never-report"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
