import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const id = "jNQXAC9IVRw";
const calls: { operation: string; args: string[] }[] = [];
let mode = "good";
let afterSubtitle = () => {};
let video: typeof import("../src/lib/video-processor");
let platforms: typeof import("../src/lib/platforms");
const original = childProcess.execFile;

before(async () => {
  const replacement = () => { throw new Error("禁止真实网络和媒体进程"); };
  Object.defineProperty(replacement, promisify.custom, { value: async (command: string, input: string[]) => {
    assert.equal(command, "python");
    assert.ok(input[0].endsWith("media_network.py"));
    const operation = input[1];
    const args = operation === "yt-dlp" ? input.slice(3) : input.slice(2);
    calls.push({ operation, args });
    if (operation === "subtitle") {
      const manual = new URL(args[0]).searchParams.get("kind") === "manual";
      const content = mode === "invalid" ? "WEBVTT\n\n00:00:05.000 --> 00:00:02.000\nInvalid time range.\n" : mode === "manual-empty" && manual ? ""
        : "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA real cue.\n";
      if (["failed", "direct-failed"].includes(mode)) throw new Error("caption unavailable");
      await fs.writeFile(args[1], content);
      afterSubtitle();
      return { stdout: "", stderr: "" };
    }
    if (args.includes("--version")) return { stdout: "2026.08.19", stderr: "" };
    if (args.includes("--dump-json")) {
      const track = (kind: string) => [{ ext: "vtt", url: `https://www.youtube.com/api/timedtext?lang=en&kind=${kind}&sig=private-fixture` }];
      return { stdout: JSON.stringify({ id, title: "fixture", duration: 19, thumbnail: "", uploader: "fixture", language: "en",
        subtitles: mode === "none" ? {} : { en: track("manual") }, automatic_captions: mode === "none" ? {} : { "en-orig": track("automatic") } }), stderr: "" };
    }
    if (args.includes("--skip-download")) {
      if (mode !== "direct-failed") throw new Error("caption unavailable");
      assert.equal(args[args.indexOf("--sub-langs") + 1], "^en$");
      const file = args[args.indexOf("--output") + 1] + ".en.vtt";
      await fs.writeFile(file, "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nCookie assisted subtitle.\n");
      return { stdout: "", stderr: "" };
    }
    assert.ok(args.includes("--print"));
    assert.equal(args[args.indexOf("--print") + 1], "after_move:%(filepath)j");
    const output = args[args.indexOf("--output") + 1].replace("%(ext)s", "webm");
    await fs.writeFile(output, "fixture media");
    return { stdout: JSON.stringify(output) + "\n", stderr: "" };
  } });
  Object.defineProperty(childProcess, "execFile", { value: replacement, configurable: true, writable: true });
  video = await import("../src/lib/video-processor");
  platforms = await import("../src/lib/platforms");
});
after(() => { childProcess.execFile = original; });

async function workspace(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-youtube-"));
  calls.length = 0;
  afterSubtitle = () => {};
  try { await run(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test("同次解析交接字幕，仅下载人工轨道，不再次解析或下载音频，公开元信息不含签名地址", async () => {
  mode = "good";
  await workspace(async (directory) => {
    const info = await video.extractVideoInfo(url);
    const result = await platforms.getProcessor(url).download(url, info, directory);
    assert.ok(result.subtitlePath?.endsWith(".en.vtt"));
    assert.equal(result.subtitle?.delivery, "direct");
    assert.equal(result.audioPath, "");
    assert.equal(calls.filter((call) => call.args.includes("--dump-json")).length, 1);
    assert.equal(calls.filter((call) => call.operation === "subtitle").length, 1);
    assert.equal(calls.some((call) => call.args.includes("-f")), false);
    assert.doesNotMatch(JSON.stringify(info), /timedtext|private-fixture|sig=/);
  });
});

test("空人工字幕清理后尝试一个自动轨道，结果有效才跳过转写", async () => {
  mode = "manual-empty";
  await workspace(async (directory) => {
    const result = await video.tryDownloadSubtitles(url, undefined, directory);
    assert.ok(result.subtitlePath?.endsWith(".en-orig.vtt"));
    assert.equal(calls.filter((call) => call.operation === "subtitle").length, 2);
    await assert.rejects(fs.access(path.join(directory, `${id}.en.vtt`)));
  });
});

for (const failure of ["invalid", "failed", "none"]) {
  test(`${failure} 字幕不阻断音频降级，返回实际 WebM 路径`, async () => {
    mode = failure;
    await workspace(async (directory) => {
      const info = await video.extractVideoInfo(url);
      const result = await platforms.getProcessor(url).download(url, info, directory);
      assert.equal(result.subtitlePath, null);
      assert.equal(result.audioPath, path.join(directory, `${id}.webm`));
      assert.equal((await fs.readdir(directory)).filter((name) => name.endsWith(".vtt")).length, 0);
      if (failure === "none") assert.equal(calls.filter((call) => call.operation === "subtitle").length, 0);
    });
  });
}

test("独立传入的元信息没有交接时只刷新一次清单，低清视频使用报告的实际路径", async () => {
  mode = "good";
  await workspace(async (directory) => {
    const info = { id, title: "fixture", duration: 19, thumbnail: "", uploader: "fixture" };
    assert.ok((await video.tryDownloadSubtitles(url, info, directory)).subtitlePath);
    assert.equal(calls.filter((call) => call.args.includes("--dump-json")).length, 1);
    assert.equal(await video.downloadLowResVideo(url, info, directory), path.join(directory, `${id}-video.webm`));
  });
});

test("直链失败保留带 Cookie 的原下载器单轨兜底，成功后不下载音频", async () => {
  mode = "direct-failed";
  await workspace(async (directory) => {
    const info = await video.extractVideoInfo(url);
    const result = await platforms.getProcessor(url).download(url, info, directory);
    assert.ok(result.subtitlePath?.endsWith(".en.vtt"));
    assert.equal(result.subtitle?.delivery, "yt-dlp");
    assert.equal(result.audioPath, "");
    assert.equal(calls.filter((call) => call.args.includes("--skip-download")).length, 1);
  });
});

test("字幕阶段结束后已撤销的分析不再下载备用轨道或音频", async () => {
  mode = "good";
  await workspace(async (directory) => {
    const info = await video.extractVideoInfo(url);
    let active = true;
    afterSubtitle = () => { active = false; };
    await assert.rejects(platforms.getProcessor(url).download(url, info, directory, () => { if (!active) throw new Error("revoked"); }), /revoked/);
    assert.equal(calls.filter((call) => call.operation === "subtitle").length, 1);
    assert.equal(calls.some((call) => call.args.includes("-f")), false);
  });
});
