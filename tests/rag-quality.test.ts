import assert from "node:assert/strict";
import { test } from "node:test";
import { searchByKeyword } from "../src/lib/rag";

// 手工合成的检索样本，仅验证关键词降级，不代表真实转写或模型回答质量。
const segments = [
  { start: 0, end: 5, text: "本项目不支持自动扣款。" },
  { start: 5, end: 10, text: "設定を変更してください。" },
  { start: 10, end: 15, text: "이 모델은 학습을 지원합니다." },
  { start: 15, end: 20, text: "版本 7 支持 RAG。" },
  { start: 20, end: 25, text: "明天开始测试。" },
];

test("关键词降级覆盖日语假名、韩文、数字和英文", () => {
  for (const [query, expected] of [["してください", 5], ["학습", 10], ["7", 15], ["rag", 15]] as const) {
    assert.equal(searchByKeyword(segments, query)[0]?.segment.start, expected, query);
  }
});

test("数字不误命中更长的数字，兼容全角字母数字", () => {
  const nearby = [{ start: 1, end: 2, text: "版本 17" }, { start: 2, end: 3, text: "版本 ７ 和 ＲＡＧ" }];
  assert.deepEqual(searchByKeyword(nearby, "7").map(hit => hit.segment.start), [2]);
  assert.deepEqual(searchByKeyword(nearby, "rag").map(hit => hit.segment.start), [2]);
});

test("不同词间不拼接出不存在的中文片段", () => {
  assert.deepEqual(searchByKeyword([{ start: 0, end: 1, text: "甲乙" }], "甲，乙"), []);
});

test("不存在或空白查询不返回证据，保留原始时间与文字", () => {
  assert.deepEqual(searchByKeyword(segments, "不存在的线索"), []);
  assert.deepEqual(searchByKeyword(segments, "   "), []);
  assert.equal(searchByKeyword(segments, "自动扣款")[0].segment, segments[0]);
});
