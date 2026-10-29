import assert from "node:assert/strict";
import { test } from "node:test";
import { durableNote, exportMarkdown, formatTime, isAnalysisResult, isStudyNote, parseTime, sourceUrl } from "../src/lib/learning";
import { readProcessResult, retryDeadline } from "../src/lib/process-stream";
import type { StudyNote } from "../src/lib/learning-types";
import { appendExcerpt, REVIEW_QUESTION, reviewAnswersQuestion, termQuestion } from "../src/lib/study-tools";
import { PENDING_PROCESS_KEY, readPendingProcess, writePendingProcess } from "../src/lib/process-recovery";
import { BACKUP_MAX_BYTES, BACKUP_MAX_NOTES, exportNotebook, parseNotebookBackup, planNotebookImport } from "../src/lib/notebook-backup";

test("恢复线索只接受有效平台/格式/时间，不保存凭据且存储失败可降级", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const pending = { version: 1 as const, url: "https://youtu.be/dQw4w9WgXcQ", startedAt: 1000 };
  assert.ok(writePendingProcess(storage, pending));
  assert.equal(readPendingProcess(storage, 2000)?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(readPendingProcess(storage, 8_000_000), null);
  assert.equal(data.size, 0);
  for (const changed of [{ url: "https://evil.example/video" }, { startedAt: 3000 }, { analysisId: "not-id" }, { version: 2 }]) {
    data.set(PENDING_PROCESS_KEY, JSON.stringify({ ...pending, ...changed }));
    assert.equal(readPendingProcess(storage, 2000), null);
    assert.equal(data.size, 0);
  }
  const blocked = { getItem: () => { throw new Error("disabled"); }, removeItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("disabled"); } };
  assert.equal(readPendingProcess(blocked), null);
  assert.equal(writePendingProcess(blocked, pending), false);
});

test("摘录按来源和时间去重，拒绝无效范围且不修改旧数组", () => {
  const draft = { kind: "transcript" as const, text: " 原文 ", start: 2, end: 5 };
  const first = appendExcerpt([], draft, "one", 1);
  assert.equal(first[0].text, "原文");
  assert.equal(appendExcerpt(first, draft, "two", 2), first);
  assert.equal(appendExcerpt(first, { ...draft, start: -1 }, "bad", 2), first);
  assert.equal(appendExcerpt(first, { ...draft, end: 1 }, "bad", 2), first);
  assert.equal(appendExcerpt(first, { ...draft, text: " " }, "bad", 2), first);
  assert.equal(appendExcerpt(first, { ...draft, kind: "summary" }, "two", 2).length, 2);
  assert.equal(first.length, 1);
});

test("学习提示明确依据边界，参考答案携带完整题目并限制长度", () => {
  assert.equal(termQuestion("  "), null);
  assert.equal(termQuestion("字".repeat(81)), null);
  assert.match(termQuestion("  RAG  ")!, /"RAG"/);
  assert.match(termQuestion("RAG")!, /补充知识/);
  assert.match(REVIEW_QUESTION, /不提供答案/);
  assert.match(reviewAnswersQuestion("第一题：如何应用？")!, /第一题：如何应用？/);
  assert.equal(reviewAnswersQuestion("字".repeat(3201)), null);
  assert.equal(reviewAnswersQuestion(" "), null);
});

test("旧版本笔记兼容，新摘录与学习用途可持久化和导出", () => {
  assert.ok(isStudyNote({ ...fixture, turns: fixture.turns.filter(t => t.status === "success") }));
  assert.deepEqual(durableNote(fixture).excerpts, []);
  const note: StudyNote = { ...fixture, excerpts: appendExcerpt([], { kind: "transcript", text: "摘录内容", start: 2, end: 5 }, "excerpt", 10), turns: [{ id: 4, question: "复习", answer: "题目", status: "success", purpose: "review" }] };
  const saved = durableNote(note);
  assert.ok(isStudyNote(saved));
  assert.equal(saved.turns[0].purpose, "review");
  assert.equal(saved.excerpts?.[0].text, "摘录内容");
  const markdown = exportMarkdown(saved, false);
  for (const part of ["重点摘录", "字幕原文", "摘录内容", "00:02"]) assert.ok(markdown.includes(part), part);
  assert.ok(!markdown.includes("never-persist"));
  assert.ok(!isStudyNote({ ...saved, excerpts: [{ ...saved.excerpts![0], end: 1 }] }));
  assert.ok(!isStudyNote({ ...saved, turns: [{ ...saved.turns[0], purpose: "invalid" }] }));
});

const fixture: StudyNote = {
  id: "local-note", version: 1, createdAt: 1, updatedAt: 2, lastViewedAt: 3, personalNote: "我的理解",
  analysis: { analysisId: "11111111-1111-4111-8111-111111111111", platform: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=fixture",
    expiresAt: 1000, framesExpireAt: 2000, video: { id: "fixture", title: "学习笔记", duration: 80, thumbnail: "", uploader: "作者" },
    transcriptSource: "whisper", transcription: { provider: "sensevoice", timing: "estimated" },
    vision: { outcome: "partial", describedFrames: 1, totalFrames: 3 }, transcriptText: "依据原文",
    transcriptSegments: [{ start: 0, end: 5, text: "依据原文" }],
    result: { overall: "核心结论", segments: [{ title: "章节", start: 0, end: 5, points: [{ time: "00:02", text: "要点" }] }] },
    frames: [{ time: 3, description: "画面文字", src: "/api/frames?token=never-persist" }],
  }, turns: [{ id: 1, question: "问题", answer: "回答 [00:02]", status: "success" }, { id: 2, question: "失败问题", answer: "网络失败", status: "error" }, { id: 3, question: "未完成", answer: "", status: "pending" }],
};

function backupFixture(): StudyNote {
  const note = durableNote(structuredClone(fixture));
  note.analysis.video.id = "dQw4w9WgXcQ";
  return note;
}

test("备份可完整恢复文字并剥离帧签名、图片与未知嵌套字段", () => {
  const note = backupFixture();
  Object.assign(note.analysis.video, { thumbnail: "https://private.example/image", token: "secret-field" });
  Object.assign(note.analysis.result, { cookies: "secret-field" });
  Object.assign(note.turns[0], { credential: "secret-field" });
  note.analysis.frames[0].src = "/api/frames?token=never-persist";
  const text = exportNotebook([note], 100);
  const parsed = parseNotebookBackup(`\uFEFF${text}`);
  assert.ok(!/secret-field|private\.example|never-persist/.test(text));
  assert.equal(parsed[0].personalNote, note.personalNote);
  assert.deepEqual(parsed[0].turns, durableNote(note).turns);
  assert.equal(parsed[0].analysis.video.thumbnail, "");
  assert.equal(note.analysis.video.thumbnail, "https://private.example/image");
  assert.equal(parsed[0].analysis.canonicalUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=0s");
});

test("备份校验拒绝损坏、空文件、未知版本、过量笔记与伪造类型，不部分导入", () => {
  const good = JSON.parse(exportNotebook([backupFixture()]));
  for (const value of [null, [], {}, { ...good, version: 2 }, { ...good, notes: [] },
    { ...good, notes: [...good.notes, { bad: true }] },
    { ...good, notes: Array(BACKUP_MAX_NOTES + 1).fill(good.notes[0]) }]) {
    assert.throws(() => parseNotebookBackup(JSON.stringify(value)));
  }
  assert.throws(() => parseNotebookBackup("{broken"), /JSON/);
  assert.throws(() => parseNotebookBackup(" ".repeat(BACKUP_MAX_BYTES + 1)), /20 MiB/);
  assert.throws(() => exportNotebook([]), /为空/);
  assert.throws(() => exportNotebook(Array(BACKUP_MAX_NOTES + 1).fill(backupFixture())), /500/);
  for (const change of [ { platform: ["youtube"] }, { framesExpireAt: "later" }, { video: { ...good.notes[0].analysis.video, id: "invalid" } } ]) {
    const changed = structuredClone(good);
    Object.assign(changed.notes[0].analysis, change);
    assert.throws(() => parseNotebookBackup(JSON.stringify(changed)));
  }
});

test("导入相同内容跳过，冲突保留副本，重复导入副本不膨胀，也不合并同视频的不同分析", () => {
  const note = backupFixture();
  const incoming = { ...note, lastViewedAt: 9000, updatedAt: 8000 };
  incoming.analysis = { ...note.analysis, expiresAt: 5000 };
  assert.equal(planNotebookImport([note], [incoming]).skipped, 1);
  const conflict = { ...note, personalNote: "另一浏览器的修改" };
  const plan = planNotebookImport([note], [conflict, conflict], () => "conflict-copy");
  assert.equal(plan.added.length, 1);
  assert.equal(plan.copies, 1);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.added[0].id, "conflict-copy");
  assert.equal(planNotebookImport([note, ...plan.added], [conflict]).skipped, 1);
  assert.equal(note.personalNote, "我的理解");
  const reanalysis = structuredClone(note);
  reanalysis.id = "second-analysis";
  reanalysis.analysis.analysisId = "22222222-2222-4222-8222-222222222222";
  assert.equal(planNotebookImport([note], [reanalysis]).added.length, 1);
  assert.throws(() => planNotebookImport([note], [conflict], () => note.id), /副本标识/);
});

test("旧笔记和B站分P备份兼容，恶意外链被重新构造", () => {
  const note = backupFixture();
  note.analysis.platform = "bilibili";
  note.analysis.video.id = "BV1L3tA66EKt_p2";
  note.analysis.canonicalUrl = "javascript:alert(1)";
  delete note.excerpts;
  const restored = parseNotebookBackup(exportNotebook([note]))[0];
  assert.match(restored.analysis.canonicalUrl, /bilibili\.com\/video\/BV1L3tA66EKt\?p=2/);
  assert.deepEqual(restored.excerpts, []);
});

test("持久化只保存文本及成功问答，不保存帧签名，不改变内存结果", () => {
  const saved = durableNote(fixture);
  assert.equal(saved.analysis.frames[0].src, undefined);
  assert.equal(saved.turns.length, 1);
  assert.ok(!JSON.stringify(saved).includes("never-persist"));
  assert.ok(fixture.analysis.frames[0].src);
  assert.ok(isStudyNote(saved));
  assert.ok(!isStudyNote({ ...saved, version: 2 }));
});

test("结果校验拒绝不完整总结、负时间和错误的字幕类型", () => {
  assert.ok(isAnalysisResult(fixture.analysis));
  assert.ok(!isAnalysisResult({ ...fixture.analysis, result: { overall: "abc" } }));
  assert.ok(!isAnalysisResult({ ...fixture.analysis, transcriptSegments: [{ start: -1, end: 5, text: "abc" }] }));
  assert.ok(!isAnalysisResult({ ...fixture.analysis, video: { ...fixture.analysis.video, duration: null } }));
});

test("Markdown 导出保留精度、原链接、画面依据和个人笔记，字幕按选项输出", () => {
  const text = exportMarkdown(fixture, false);
  for (const part of ["估算时间", "我的理解", "核心结论", "画面文字", "https://www.youtube.com", "回答 [00:02]"]) assert.ok(text.includes(part), part);
  assert.ok(!text.includes("## 字幕原文"));
  assert.ok(!text.includes("失败问题"));
  assert.ok(exportMarkdown(fixture, true).includes("依据原文"));
  assert.ok(!text.includes("never-persist"));
});

test("外链只由平台和 ID 生成，小时与估算时间保持一致", () => {
  assert.equal(parseTime("01:02:03"), 3723);
  assert.equal(formatTime(3723), "1:02:03");
  assert.equal(parseTime("02:61"), null);
  assert.equal(parseTime("bad"), null);
  assert.ok(sourceUrl(fixture.analysis, 12.9).endsWith("&t=12s"));
  assert.equal(sourceUrl({ ...fixture.analysis, platform: "douyin" }, 12), "https://www.douyin.com/video/fixture");
});

function stream(events: unknown[], chunkSize = 7) {
  const body = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
  return new Response(new ReadableStream({ start(controller) { for (let at = 0; at < body.length; at += chunkSize) controller.enqueue(body.slice(at, at + chunkSize)); controller.close(); } }));
}

test("SSE 分片兼容 UTF-8，只有合法 result 才完成，生成中的 JSON 不进入界面", async () => {
  let generating = 0;
  const result = await readProcessResult(stream([{ type: "heartbeat" }, { type: "stream_start" }, { type: "stream", text: '{"overall":"半截' }, { type: "result", data: fixture.analysis }]), () => {}, () => generating++);
  assert.equal(result.result.overall, "核心结论");
  assert.equal(generating, 2);
});

test("SSE done/stream_end/静默 EOF 不当作完成；错误和无效结果均明确失败", async () => {
  const interrupted = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("network failure")); } }));
  await assert.rejects(readProcessResult(interrupted, () => {}, () => {}), /连接中断/);
  for (const events of [[], [{ type: "progress", step: "done", percent: 100 }], [{ type: "stream_end" }]]) {
    await assert.rejects(readProcessResult(stream(events), () => {}, () => {}), /连接中断/);
  }
  await assert.rejects(readProcessResult(stream([{ type: "error", message: "模拟失败" }]), () => {}, () => {}), /模拟失败/);
  await assert.rejects(readProcessResult(stream([{ type: "result", data: {} }]), () => {}, () => {}), /内容不完整/);
});

test("限流 Retry-After 支持秒数和 HTTP 日期，不自动重发请求", () => {
  assert.equal(retryDeadline("5", 1000), 6000);
  assert.equal(retryDeadline("Thu, 01 Jan 1970 00:01:00 GMT", 1000), 60000);
  assert.equal(retryDeadline(null, 1000), 61000);
});

test("B 站笔记持久化和导出保留分 P，错误 ID 不导入", () => {
  const note: StudyNote = { ...durableNote(fixture), analysis: { ...fixture.analysis, platform: "bilibili", video: { ...fixture.analysis.video, id: "BV1xx411c7mD_p2" }, canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2" } };
  assert.ok(isStudyNote(note));
  const saved = durableNote(note);
  assert.ok(isStudyNote(saved));
  assert.match(saved.analysis.canonicalUrl, /p=2/);
  assert.match(exportMarkdown(saved, true), /bilibili\.com\/video\/BV1xx411c7mD\?p=2/);
  assert.equal(isAnalysisResult({ ...note.analysis, video: { ...note.analysis.video, id: "invalid" } }), false);
});
