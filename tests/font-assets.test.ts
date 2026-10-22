import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

test("本地字体资产与固定清单一致，全部子集可打包且不引用外部字体", async () => {
  const directory = path.join(process.cwd(), "src", "app", "fonts");
  const manifest: { files: { file: string; sha256: string; bytes: number }[] } = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.files.length, 11);
  for (const item of manifest.files) {
    assert.match(item.file, /^geist-(?:mono-)?[a-z-]+\.woff2$/);
    const contents = await fs.readFile(path.join(directory, item.file));
    assert.equal(contents.subarray(0, 4).toString("ascii"), "wOF2");
    assert.equal(contents.length, item.bytes);
    assert.equal(createHash("sha256").update(contents).digest("hex"), item.sha256);
  }
  const css = await fs.readFile(path.join(directory, "fonts.css"), "utf8");
  assert.equal((css.match(/@font-face/g) ?? []).length, 13);
  assert.deepEqual(new Set([...css.matchAll(/url\(\.\/([^\)]+)\)/g)].map((match) => match[1])), new Set(manifest.files.map((item) => item.file)));
  assert.doesNotMatch(css, /https?:\/\//);
  assert.match(css, /size-adjust:104\.76%/);
  assert.match(css, /size-adjust:134\.59%/);
  const license = await fs.readFile(path.join(directory, "OFL.txt"), "utf8");
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});
