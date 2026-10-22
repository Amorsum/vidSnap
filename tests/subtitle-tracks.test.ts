import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSubtitleTracks, SubtitleTrackHandoff } from "../src/lib/subtitle-tracks";

const vtt = (url = "https://www.youtube.com/api/timedtext?lang=en") => ({ ext: "vtt", url });

test("字幕选择优先原语言人工轨道，自动轨道独立作为兜底", () => {
  const tracks = selectSubtitleTracks({ language: "ja", subtitles: { en: [vtt()], ja: [vtt()] },
    automatic_captions: { "ja-orig": [vtt()], zh: [vtt("https://www.youtube.com/api/timedtext?tlang=zh")] } });
  assert.deepEqual(tracks.map((track) => [track.language, track.kind]), [["ja", "manual"], ["ja-orig", "automatic"]]);
});

test("缺少语言提示时使用稳定偏好，每类至多一个且优先 VTT", () => {
  const tracks = selectSubtitleTracks({ subtitles: { en: [vtt()], "zh-Hans": [{ ...vtt(), ext: "srt" }, vtt()] },
    automatic_captions: { en: [vtt()], "ko-orig": [vtt()] } });
  assert.deepEqual(tracks.map((track) => [track.language, track.format]), [["zh-Hans", "vtt"], ["ko-orig", "vtt"]]);
});

test("显式翻译、非法语言、非 HTTPS/带凭据、无效格式不参与字幕选择", () => {
  for (const data of [null, {}, { subtitles: [] }, { subtitles: { "../escape": [vtt()] } },
    { subtitles: { en: [{ ext: "json3", url: vtt().url }] } },
    ...["http://www.youtube.com/caption", "https://secret@www.youtube.com/caption", "https://www.youtube.com:8443/caption", "https://www.youtube.com/caption?tlang=zh", "https://www.youtube.com/caption\n", "invalid"].map((url) => ({ subtitles: { en: [vtt(url)] } }))]) {
    assert.deepEqual(selectSubtitleTracks(data), []);
  }
});

test("交接按对象身份/规范 URL 隔离，消费后移除，空清单不同于缺失", () => {
  const handoff = new SubtitleTrackHandoff<object>();
  const info = { id: "same" };
  handoff.remember(info, "canonical", []);
  assert.equal(handoff.take({ id: "same" }, "canonical"), undefined);
  assert.deepEqual(handoff.take(info, "canonical"), []);
  assert.equal(handoff.take(info, "canonical"), undefined);
  handoff.remember(info, "canonical", []);
  assert.equal(handoff.take(info, "different"), undefined);
});

test("交接在两分钟边界失效，最多 32 条，输入更改不能污染已记录轨道", () => {
  let now = 0;
  const handoff = new SubtitleTrackHandoff<object>(() => now);
  const first = {};
  handoff.remember(first, "url", []);
  const keys = Array.from({ length: 32 }, () => ({}));
  for (const key of keys) handoff.remember(key, "url", []);
  assert.equal(handoff.take(first, "url"), undefined);
  now = 120000;
  assert.equal(handoff.take(keys[0], "url"), undefined);
  const tracks = selectSubtitleTracks({ subtitles: { en: [vtt()] } });
  handoff.remember(first, "url", tracks);
  tracks[0].url = "changed";
  assert.notEqual(handoff.take(first, "url")?.[0].url, "changed");
});
