import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPlatform, extractUrl, isValidUrl, normalizeVideoUrl, parseVideoUrl } from "../src/lib/url-utils";

const id = "dQw4w9WgXcQ";
const canonical = `https://www.youtube.com/watch?v=${id}`;

for (const url of [
  canonical,
  `http://youtube.com/watch?feature=share&v=${id}&t=30`,
  `https://m.youtube.com/shorts/${id}?si=share`,
  `https://music.youtube.com/watch?v=${id}`,
  `https://www.youtube.com/embed/${id}`,
  `https://youtube.com/v/${id}/`,
  `HTTPS://YOUTU.BE/${id}?si=share`,
]) {
  test(`YouTube 规范化：${url}`, () => {
    assert.deepEqual(parseVideoUrl(url), { platform: "youtube", url: canonical, videoId: id });
    assert.equal(detectPlatform(url), "youtube");
    assert.equal(isValidUrl(url), true);
  });
}

for (const url of [
  `https://evil.example/?next=${canonical}`,
  `https://notyoutube.com/watch?v=${id}`,
  `https://youtube.com.evil.example/watch?v=${id}`,
  `https://evil.example/youtu.be/${id}`,
  `https://user@www.youtube.com/watch?v=${id}`,
  `https://@www.youtube.com/watch?v=${id}`,
  `https://www.youtube.com:8080/watch?v=${id}`,
  `https://www.youtube.com./watch?v=${id}`,
  `ftp://www.youtube.com/watch?v=${id}`,
  `javascript:${canonical}`,
  `//www.youtube.com/watch?v=${id}`,
  `https://www.you\ntube.com/watch?v=${id}`,
  `https://www.youtube.com\\@evil.example/watch?v=${id}`,
  `https://youtube.com/watch?v=${id}extra`,
  `https://youtu.be/${id}/extra`,
  `https://youtube.com/watch?v=${id}&v=${id}`,
  `https://youtube.com/redirect?q=${canonical}`,
  "https://www.douyin.com/user/someone",
  "https://v.douyin.com/",
  "https://evil.example/?url=https://www.douyin.com/video/123",
  "https://www.douyin.com/video/../user/123",
  "http://127.0.0.1/video/123",
  "http://169.254.169.254/",
  "https://v.douyin.com/code/extra",
  "https://www.douyin.com/video/abc",
  "https://www.douyin.com/video/" + "1".repeat(33),
  canonical + "&x=" + "a".repeat(4096),
]) {
  test(`拒绝非法入口：${url.slice(0, 110).replaceAll("\n", "\\n")}`, () => {
    assert.equal(parseVideoUrl(url), null);
    assert.equal(detectPlatform(url), null);
    assert.equal(isValidUrl(url), false);
    assert.throws(() => normalizeVideoUrl(url));
  });
}

test("拒绝非字符串 URL", () => {
  for (const value of [null, undefined, [], {}, 12, true]) assert.equal(parseVideoUrl(value), null);
});

test("抖音规范链接和短链接移除分享参数", () => {
  assert.deepEqual(parseVideoUrl("http://www.douyin.com/video/123456/?from=share"), {
    platform: "douyin", videoId: "123456", url: "https://www.douyin.com/video/123456",
  });
  assert.deepEqual(parseVideoUrl("https://v.douyin.com/abc_DEF-123/?from=share"), {
    platform: "douyin", url: "https://v.douyin.com/abc_DEF-123/",
  });
});

test("分享文本与纯 URL 使用同一提取逻辑", () => {
  assert.equal(extractUrl("复制打开抖音 https://v.douyin.com/AbCd/ 查看视频"), "https://v.douyin.com/AbCd/");
  assert.equal(extractUrl("看看（https://v.douyin.com/AbCd/）。"), "https://v.douyin.com/AbCd/");
  assert.equal(extractUrl(`${canonical} 更多分享文字`), canonical);
  assert.equal(extractUrl(` ${canonical} `), canonical);
  assert.equal(extractUrl("没有链接"), "没有链接");
});

for (const [input, id, page] of [
  ["https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=share", "BV1xx411c7mD", "1"],
  ["https://m.bilibili.com/video/av170001?p=2&t=90", "av170001", "2"],
  ["http://bilibili.com/video/BV1xx411c7mD?p=3", "BV1xx411c7mD", "3"],
]) {
  test(`B 站规范化保留分 P：${input}`, () => {
    assert.deepEqual(parseVideoUrl(input), { platform: "bilibili", videoId: `${id}_p${page}`, url: `https://www.bilibili.com/video/${id}?p=${page}` });
  });
}
test("B 站分享短链和文案", () => {
  assert.equal(extractUrl("来学习【教程】 https://b23.tv/AbCd123，复制打开"), "https://b23.tv/AbCd123");
  assert.deepEqual(parseVideoUrl("https://b23.tv/AbCd123?share=1"), { platform: "bilibili", url: "https://b23.tv/AbCd123" });
});
for (const url of ["https://bilibili.com.evil.test/video/BV1xx411c7mD", "https://space.bilibili.com/123", "https://www.bilibili.com/bangumi/play/ss123", "https://b23.tv/", "https://b23.tv/abc/extra", "https://user@b23.tv/abc", "https://b23.tv:8080/abc", ...["0", "-1", "1.5", "", "100000", "1&p=2"].map(p => `https://www.bilibili.com/video/BV1xx411c7mD?p=${p}`)]) {
  test(`拒绝非法 B 站入口：${url}`, () => assert.equal(parseVideoUrl(url), null));
}
