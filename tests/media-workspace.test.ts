import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { withMediaWorkspace } from "../src/lib/media-workspace";

test("成功后删除本次临时目录并保留返回值", async () => {
  let directory = "";
  const value = await withMediaWorkspace(async (current) => {
    directory = current;
    await fs.writeFile(path.join(current, "video.m4a"), "test");
    return "完成";
  });
  assert.equal(value, "完成");
  await assert.rejects(fs.stat(directory), { code: "ENOENT" });
});

test("下载或转写失败也删除部分文件，保留原始异常", async () => {
  let directory = "";
  const failure = new Error("模拟转写失败");
  await assert.rejects(withMediaWorkspace(async (current) => {
    directory = current;
    await fs.writeFile(path.join(current, "video.part"), "partial");
    throw failure;
  }), (error) => error === failure);
  await assert.rejects(fs.stat(directory), { code: "ENOENT" });
});

test("同视频并发调用清理互不影响", async () => {
  await withMediaWorkspace(async (first) => {
    const firstFile = path.join(first, "same-id.m4a");
    await fs.writeFile(firstFile, "第一个请求");
    await withMediaWorkspace(async (second) => {
      assert.notEqual(first, second);
      await fs.writeFile(path.join(second, "same-id.m4a"), "第二个请求");
    });
    assert.equal(await fs.readFile(firstFile, "utf8"), "第一个请求");
  });
});
