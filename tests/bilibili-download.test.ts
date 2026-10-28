import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sourceUrl } from "../src/lib/learning";

const id = "BV1xx411c7mD";
const url = `https://www.bilibili.com/video/${id}?p=2`;
const calls: string[][] = [];
let mode = "inline";
let processor: ReturnType<typeof import("../src/lib/platforms").getProcessor>;
const original = childProcess.execFile;
before(async () => {
  const replacement = () => { throw new Error("禁止真实下载"); };
  Object.defineProperty(replacement, promisify.custom, { value: async (_command: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "resolve-bilibili") return { stdout: url, stderr: "" };
    if (args.includes("--version")) return { stdout: "2026.10.01", stderr: "" };
    assert.equal(args[1], "yt-dlp-bilibili");
    if (args.includes("--dump-json")) {
      assert.ok(args.includes("--simulate"));
      assert.ok(args.includes("--write-subs"));
      return { stdout: JSON.stringify({ id: `${id}_p2`, title: "B 站测试", duration: 10, uploader: "测试作者", thumbnail: "",
        subtitles: { danmaku: [{ ext: "xml", url: "https://comment.bilibili.com/123.xml" }],
          ...(mode === "none" ? {} : { "ai-zh": [{ ext: "srt", data: mode === "invalid" ? "invalid" : "1\n00:00:00,000 --> 00:00:02,000\n学习证据\n" }] }) } }), stderr: "" };
    }
    assert.equal(args.at(-1), url, "后续下载复用已解析规范分 P");
    assert.ok(args.includes("--no-playlist"));
    const output = args[args.indexOf("--output") + 1].replace("%(ext)s", "mp4");
    await fs.writeFile(output, "media fixture");
    return { stdout: JSON.stringify(output), stderr: "" };
  } });
  Object.defineProperty(childProcess, "execFile", { value: replacement, configurable: true, writable: true });
  processor = (await import("../src/lib/platforms")).getProcessor(url);
});
after(() => { childProcess.execFile = original; });
async function workspace(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-bilibili-test-"));
  calls.length = 0;
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test("B 站内联 SRT 优先，忽略弹幕且不下载音频", async () => {
  mode = "inline";
  await workspace(async directory => {
    const info = await processor.getInfo(url);
    const result = await processor.download(url, info, directory);
    assert.equal(info.id, `${id}_p2`);
    assert.equal(info.canonicalUrl, url);
    assert.equal(result.audioPath, "");
    assert.equal(result.subtitle?.kind, "automatic");
    assert.equal(result.subtitle?.delivery, "inline");
    assert.match(await fs.readFile(result.subtitlePath!, "utf-8"), /学习证据/);
    assert.equal(calls.filter(args => args.includes("--dump-json")).length, 1);
    assert.ok(!calls.some(args => args.includes("-f")));
    assert.ok(!JSON.stringify(info).includes("学习证据"));
  });
});
for (const failure of ["none", "invalid"]) {
  test(`B 站 ${failure} 字幕降级音频并清理坏字幕`, async () => {
    mode = failure;
    await workspace(async directory => {
      const info = await processor.getInfo(url);
      const result = await processor.download(url, info, directory);
      assert.equal(result.subtitlePath, null);
      assert.equal(result.audioPath, path.join(directory, `${id}_p2.mp4`));
      assert.ok(!(await fs.readdir(directory)).some(name => name.endsWith(".srt")));
    });
  });
}
test("B 站短链只解析一次，视觉下载保留指定分 P", async () => {
  mode = "inline";
  await workspace(async directory => {
    const short = "https://b23.tv/fixture";
    const info = await processor.getInfo(short);
    await processor.download(short, info, directory);
    const file = await processor.downloadVideo!(short, info, directory);
    assert.equal(file, path.join(directory, `${id}_p2-video.mp4`));
    assert.equal(calls.filter(args => args[1] === "resolve-bilibili").length, 1);
    assert.equal(calls.at(-1)!.at(-1), url);
  });
});
test("B 站原视频时间链接保持分 P", () => {
  assert.equal(sourceUrl({ platform: "bilibili", video: { id: `${id}_p2`, title: "", duration: 10, thumbnail: "", uploader: "" } }, 7.9), `${url}&t=7`);
});
