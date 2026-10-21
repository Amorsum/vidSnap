import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

const videoId = "dQw4w9WgXcQ";
const canonical = `https://www.youtube.com/watch?v=${videoId}`;
const info = { id: videoId, title: "测试视频", duration: 5, thumbnail: "", uploader: "测试作者" };
const transcription = { text: "测试语音", segments: [{ start: 0, end: 5, text: "测试语音" }], language: "zh" };
const outputDirectories: string[] = [];
let failure: "download" | "asr" | "llm" | undefined;
let extractTextFromVideo: typeof import("../src/lib/video-processor").extractTextFromVideo;
let transcribe: typeof import("../src/app/api/process/transcribe/route");
let summarize: typeof import("../src/app/api/process/summarize/route");
let sequence = 0;
const originalExecFile = childProcess.execFile;

before(async () => {
  process.env.ACCESS_CODE = "legacy-regression-only";
  process.env.DEEPSEEK_API_KEY = "mock-provider-key";
  process.env.LLM_PROVIDER = "deepseek";
  // 替代 promisify(execFile) 的实际执行路径；任何未预期的命令直接失败。
  const mockedExecFile = () => { throw new Error("禁止启动真实媒体进程"); };
  Object.defineProperty(mockedExecFile, promisify.custom, {
    value: async (command: string, args: string[]) => {
      if (command === "yt-dlp") {
        if (args.includes("--version")) return { stdout: "2026.01.01", stderr: "" };
        assert.equal(args.at(-1), canonical, "只把规范 URL 交给下载器");
        if (args.includes("--dump-json")) return { stdout: JSON.stringify(info), stderr: "" };
        const output = args[args.indexOf("--output") + 1].replace("%(ext)s", "m4a");
        outputDirectories.push(path.dirname(output));
        await fs.writeFile(output, "fake-audio");
        if (failure === "download") throw new Error("内部下载错误 /server/private/file");
        return { stdout: "", stderr: "" };
      }
      if (command === "python") {
        assert.equal(await fs.readFile(args[1], "utf8"), "fake-audio");
        if (failure === "asr") throw new Error("内部 ASR 错误 /server/private/file");
        return { stdout: JSON.stringify(transcription), stderr: "" };
      }
      throw new Error(`未预期的命令：${command}`);
    },
  });
  Object.defineProperty(childProcess, "execFile", { value: mockedExecFile, configurable: true, writable: true });
  mock.method(globalThis, "fetch", async () => {
    assert.equal(await directoryExists(outputDirectories.at(-1)!), false, "调用总结模型前音频已清理");
    if (failure === "llm") return Response.json({ error: "internal provider detail" }, { status: 500 });
    return Response.json({ choices: [{ message: { content: "测试总结" } }] });
  });
  ({ extractTextFromVideo } = await import("../src/lib/video-processor"));
  transcribe = await import("../src/app/api/process/transcribe/route");
  summarize = await import("../src/app/api/process/summarize/route");
});

after(() => {
  childProcess.execFile = originalExecFile;
  mock.restoreAll();
});

async function directoryExists(directory: string) {
  try {
    await fs.stat(directory);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function request() {
  return new NextRequest("http://localhost/api/legacy-test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": "legacy-regression-only", "cf-connecting-ip": `test-legacy-${++sequence}` },
    body: JSON.stringify({ url: `https://youtu.be/${videoId}?si=share` }),
  });
}

for (const stage of [undefined, "download", "asr", "llm"] as const) {
  test(`历史总结接口：${stage ?? "成功"} 分支均清理自己的文件并保留契约`, async () => {
    failure = stage;
    const response = await summarize.POST(request());
    assert.equal(await directoryExists(outputDirectories.at(-1)!), false);
    const data = await response.json();
    assert.equal(response.status, stage ? 500 : 200);
    if (stage) {
      assert.doesNotMatch(data.error, /server\/private|internal provider detail/);
    } else {
      assert.equal(data.video.id, videoId);
      assert.deepEqual(data.transcription, { ...transcription, source: "asr" });
      assert.equal(data.summary, "测试总结");
      assert.equal(data.provider, "deepseek");
      assert.equal(data.mode, "summary");
    }
  });
}

test("历史转写接口成功后清理媒体并保留原响应字段", async () => {
  failure = undefined;
  const response = await transcribe.POST(request());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.video.id, videoId);
  assert.deepEqual(data.transcription, { ...transcription, source: "asr" });
  assert.equal(await directoryExists(outputDirectories.at(-1)!), false);
});

test("同视频并发转写独占目录，结束一份不会删掉另一份", async () => {
  failure = undefined;
  await extractTextFromVideo(canonical, async (firstPath) => {
    await extractTextFromVideo(canonical, async (secondPath) => {
      assert.notEqual(firstPath, secondPath);
      assert.equal(await fs.readFile(secondPath, "utf8"), "fake-audio");
      return transcription;
    });
    assert.equal(await fs.readFile(firstPath, "utf8"), "fake-audio");
    return transcription;
  });
  for (const directory of outputDirectories) assert.equal(await directoryExists(directory), false);
});
