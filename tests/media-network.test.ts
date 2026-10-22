import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const original = childProcess.execFile;
const calls: { command: string; args: string[]; timeout: number }[] = [];
let runYtDlp: typeof import("../src/lib/media-network").runYtDlp;
let downloadPublicMedia: typeof import("../src/lib/media-network").downloadPublicMedia;
let downloadPublicSubtitle: typeof import("../src/lib/media-network").downloadPublicSubtitle;
let downloadDouyinVideoAndAudio: typeof import("../src/lib/douyin-processor").downloadDouyinVideoAndAudio;

before(async () => {
  const replacement = () => { throw new Error("禁止真实媒体访问"); };
  Object.defineProperty(replacement, promisify.custom, {
    value: async (command: string, args: string[], options: { timeout: number }) => {
      calls.push({ command, args, timeout: options.timeout });
      return { stdout: "", stderr: "" };
    },
  });
  Object.defineProperty(childProcess, "execFile", { value: replacement, configurable: true, writable: true });
  ({ runYtDlp, downloadPublicMedia, downloadPublicSubtitle } = await import("../src/lib/media-network"));
  ({ downloadDouyinVideoAndAudio } = await import("../src/lib/douyin-processor"));
});

test("字幕直链下载复用 Python 出站边界及明确预算", async () => {
  await downloadPublicSubtitle("https://www.youtube.com/api/timedtext?sig=fixture", "caption.vtt");
  assert.deepEqual(calls.at(-1)?.args.slice(1), ["subtitle", "https://www.youtube.com/api/timedtext?sig=fixture", "caption.vtt"]);
  assert.equal(calls.at(-1)?.timeout, 45000);
});

after(() => { childProcess.execFile = original; });

test("yt-dlp 元数据/字幕/媒体命令均通过有超时的 Python 网络边界", async () => {
  for (const args of [["--dump-json", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"], ["--skip-download"], ["-f", "bestaudio"]]) {
    await runYtDlp(args, 30000);
    const call = calls.at(-1)!;
    assert.equal(call.command, "python");
    assert.equal(path.basename(call.args[0]), "media_network.py");
    assert.deepEqual(call.args.slice(1), ["yt-dlp", "30", ...args]);
    assert.equal(call.timeout, 40000);
  }
});

test("抖音直链使用受控下载，不交给 FFmpeg 网络输入", async () => {
  await downloadPublicMedia("https://v3.douyinvod.com/test", "fixture.mp4");
  assert.deepEqual(calls.at(-1)?.args.slice(1), ["download", "https://v3.douyinvod.com/test", "fixture.mp4"]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-egress-"));
  const start = calls.length;
  try {
    await downloadDouyinVideoAndAudio("https://v3.douyinvod.com/test", "123", true, directory);
    const commands = calls.slice(start);
    assert.equal(commands.length, 2);
    assert.equal(commands[0].args[1], "download");
    assert.equal(commands[1].command, "ffmpeg");
    assert.equal(commands[1].args[commands[1].args.indexOf("-i") + 1], path.join(directory, "123.mp4"));
    assert.equal(commands[1].args[commands[1].args.indexOf("-protocol_whitelist") + 1], "file,pipe");
    assert.equal(commands[1].args.some((arg) => arg.startsWith("https://")), false);
  } finally {
    await fs.rmdir(directory);
  }
});
