import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { needsChunkedTranscription, transcribeLongAudio } from "../src/lib/long-transcription";
import { transcribeWithSenseVoice } from "../src/lib/sensevoice";
import type { TranscriptResult } from "../src/lib/transcriber";

let directory = "";
let audio = "";
const savedKey = process.env.SENSEVOICE_API_KEY;
const originalFetch = globalThis.fetch;
const exec = promisify(execFile);
const cloudResult = (text: string): TranscriptResult => ({ text, segments: [], source: "whisper", transcription: { provider: "sensevoice", timing: "estimated" } });
const localResult: TranscriptResult = { text: "本地识别。", segments: [{ start: 1, end: 2, text: "本地识别。" }], source: "whisper", transcription: { provider: "whisper", timing: "source" } };

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-long-test-"));
  audio = path.join(directory, "fixture.m4a");
  await exec("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "605", "-c:a", "aac", "-b:a", "8k", audio], { timeout: 30_000, windowsHide: true });
  process.env.SENSEVOICE_API_KEY = "fixture-only";
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (savedKey === undefined) delete process.env.SENSEVOICE_API_KEY; else process.env.SENSEVOICE_API_KEY = savedKey;
  await fs.unlink(audio).catch(() => {});
  await fs.rmdir(directory);
});
async function noChunksRemain() { assert.deepEqual(await fs.readdir(directory), ["fixture.m4a"]); }

test("超过五分钟或 40 MiB 才分段，短视频继续原路径", async () => {
  assert.equal(await needsChunkedTranscription(audio, 300), false);
  assert.equal(await needsChunkedTranscription(audio, 301), true);
  assert.equal(await needsChunkedTranscription(audio, 0), true);
  const large = path.join(directory, "large.m4a");
  const file = await fs.open(large, "w");
  try { await file.truncate(40 * 1024 * 1024 + 1); assert.equal(await needsChunkedTranscription(large, 1), true); }
  finally { await file.close(); await fs.unlink(large); }
});

test("真实 FFmpeg 切分后按分段偏移估算时间，进度完成并清理", async () => {
  let cloudCalls = 0;
  const progress: number[] = [];
  const result = await transcribeLongAudio(audio, { duration: 605, onProgress: n => progress.push(n) }, {
    cloud: async (_file, onProgress) => { cloudCalls++; onProgress?.(50); return cloudResult(`第${cloudCalls}段。后续。`); },
    local: async () => { throw new Error("不应降级"); },
  });
  assert.equal(cloudCalls, 3);
  assert.equal(result.transcription?.provider, "sensevoice");
  assert.equal(result.transcription?.timing, "estimated");
  assert.equal(result.segments.length, 6);
  assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments[2].start, 300);
  assert.equal(result.segments[4].start, 600);
  assert.ok(result.segments.at(-1)!.end <= 605.1);
  assert.equal(progress.at(-1), 100);
  await noChunksRemain();
});

test("云端中途失败仅从该段降级，本地时间加分段偏移，标明估算", async () => {
  let cloudCalls = 0, localCalls = 0;
  const result = await transcribeLongAudio(audio, { duration: 605 }, {
    cloud: async () => { if (++cloudCalls === 2) throw new Error("fixture unavailable"); return cloudResult("第一段。"); },
    local: async () => { localCalls++; return localResult; },
  });
  assert.equal(cloudCalls, 2);
  assert.equal(localCalls, 2);
  assert.deepEqual(result.transcription, { provider: "unknown", timing: "estimated" });
  assert.equal(result.segments[1].start, 301);
  assert.equal(result.segments[2].start, 601);
  assert.equal(result.text, "第一段。 本地识别。 本地识别。");
  await noChunksRemain();
});

test("无语音分段跳过；全部无语音时明确失败", async () => {
  const silent = { cloud: async () => cloudResult(""), local: async () => localResult };
  await assert.rejects(transcribeLongAudio(audio, { duration: 605 }, silent), /没有检测到语音/);
  let call = 0;
  const result = await transcribeLongAudio(audio, { duration: 605 }, { ...silent, cloud: async () => cloudResult(++call === 2 ? "中间说话。" : "") });
  assert.equal(result.segments[0].start, 300);
  assert.equal(result.segments.length, 1);
  await noChunksRemain();
});

test("本地转写失败报告具体段且清理，删除后不继续处理", async () => {
  let calls = 0;
  await assert.rejects(transcribeLongAudio(audio, { duration: 605 }, {
    cloud: async () => { if (++calls === 2) throw new Error("cloud failed"); return cloudResult("第一段。"); },
    local: async () => { throw new Error("fixture failed"); },
  }), /转写第 2\/3 段失败/);
  await noChunksRemain();
  let activeCalls = 0;
  await assert.rejects(transcribeLongAudio(audio, { duration: 605, assertActive: () => { if (++activeCalls === 4) throw new Error("已删除"); } }, {
    cloud: async () => cloudResult("片段。"), local: async () => localResult,
  }), /已删除/);
  await noChunksRemain();
});

test("云端请求正文也受超时约束，短片时间不超过视频时长", async () => {
  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal;
    return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  await assert.rejects(transcribeWithSenseVoice(audio, undefined, { timeoutMs: 30 }));
  globalThis.fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) { init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true }); },
  }));
  await assert.rejects(transcribeWithSenseVoice(audio, undefined, { timeoutMs: 30 }));
  globalThis.fetch = async () => Response.json({ text: "一句。第二句。" });
  const result = await transcribeWithSenseVoice(audio, undefined, { duration: 10 });
  assert.equal(result.segments.at(-1)!.end, 10);
  assert.equal(result.transcription?.timing, "estimated");
  globalThis.fetch = originalFetch;
});
