import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveMediaOutput } from "../src/lib/media-output";

test("实际 WebM 输出优先于目录中旧 M4A，支持空格和 Unicode 目录", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-output-字幕 "));
  try {
    const actual = path.join(directory, "video.webm");
    await fs.writeFile(actual, "audio");
    await fs.writeFile(path.join(directory, "video.m4a"), "stale");
    assert.equal(await resolveMediaOutput(JSON.stringify(actual) + "\n", directory, "video", ["webm", "m4a"]), actual);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("不接受空输出、多个输出、相对路径、目录外/其他视频/部分文件及不支持格式", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-output-"));
  try {
    const actual = path.join(directory, "video.webm");
    for (const output of ["", "[download] done", JSON.stringify("video.webm"), `${JSON.stringify(actual)}\n${JSON.stringify(actual)}`,
      JSON.stringify(path.join(directory, "..", "video.webm")), JSON.stringify(path.join(directory, "other.webm")),
      JSON.stringify(path.join(directory, "video.webm.part")), JSON.stringify(path.join(directory, "video.exe"))]) {
      await assert.rejects(resolveMediaOutput(output, directory, "video", ["webm"]));
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("不存在、空文件或同名目录不能作为已下载媒体", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-output-"));
  const actual = path.join(directory, "video.webm");
  try {
    await assert.rejects(resolveMediaOutput(JSON.stringify(actual), directory, "video", ["webm"]), /下载后的媒体文件不存在或无法读取/);
    await fs.writeFile(actual, "");
    await assert.rejects(resolveMediaOutput(JSON.stringify(actual), directory, "video", ["webm"]));
    await fs.unlink(actual);
    await fs.mkdir(actual);
    await assert.rejects(resolveMediaOutput(JSON.stringify(actual), directory, "video", ["webm"]));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
