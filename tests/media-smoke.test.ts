import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { checkMedia, validateSample, errorCategory, SAMPLE_ID, SAMPLE_URL, MAX_AUDIO_BYTES } from "../scripts/media-smoke";

function info() {
  return { id: SAMPLE_ID, duration: 19, is_live: false, live_status: "not_live",
    formats: [{ format_id: "249", acodec: "opus", vcodec: "none", protocol: "https", filesize: 1000, ext: "webm" }],
    subtitles: { en: [{ ext: "vtt", url: "https://www.youtube.com/private-signature" }] } };
}

type FixtureOptions = { metadata?: unknown; fail?: "metadata" | "subtitle" | "audio" | "probe"; subtitle?: string; audioBytes?: number; duration?: string };
function fixture(options: FixtureOptions = {}) {
  const calls: { args: string[]; timeout: number }[] = [];
  let directory: string | undefined;
  const dependencies = {
    async run(args: string[], timeout: number) {
      calls.push({ args, timeout });
      const stage = args.includes("--dump-single-json") ? "metadata" : args.includes("--write-subs") ? "subtitle" : "audio";
      const output = args[args.indexOf("--output") + 1];
      if (stage !== "metadata") directory = path.dirname(output);
      if (options.fail === stage) {
        if (directory) await fs.writeFile(path.join(directory, "partial.part"), "incomplete");
        throw Object.assign(new Error("private-error"), { stderr: "HTTP Error 403: https://private-signature/?token=secret" });
      }
      if (stage === "metadata") return { stdout: JSON.stringify(options.metadata === undefined ? info() : options.metadata), stderr: "" };
      if (stage === "subtitle") await fs.writeFile(`${output}.en.vtt`, options.subtitle ?? "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nprivate-subtitle-content\n");
      else await fs.writeFile(output.replace("%(ext)s", "webm"), Buffer.alloc(options.audioBytes ?? 100));
      return { stdout: "private-downloader-output", stderr: "" };
    },
    async probe(file: string) {
      assert.equal(path.dirname(file), directory);
      if (options.fail === "probe") throw new Error("private-probe-output");
      return JSON.stringify({ format: { duration: options.duration ?? "19.021" }, streams: [{ codec_type: "audio" }] });
    },
  };
  return { dependencies, calls, directory: () => directory };
}

test("媒体验收拒绝错误 ID、未知/超长时长和直播，不发起后续下载", async () => {
  for (const metadata of [null, [], {}, { ...info(), id: "other" }, { ...info(), duration: NaN }, { ...info(), duration: 0 },
    { ...info(), duration: 31 }, { ...info(), is_live: true }, { ...info(), live_status: "is_upcoming" }]) {
    assert.throws(() => validateSample(metadata));
    const fake = fixture({ metadata });
    const report = await checkMedia(fake.dependencies);
    assert.equal(report.media_sample_verified, false);
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(report.checks.map((item) => item.status), ["fail", "skip", "skip", "pass"]);
  }
});

test("媒体验收不选择未知/超大/分片/视频格式或不安全格式 ID", () => {
  for (const format of [{ filesize: undefined }, { filesize: MAX_AUDIO_BYTES + 1 }, { protocol: "m3u8_native" },
    { vcodec: "h264" }, { acodec: "none" }, { format_id: "--exec" }, { ext: "exe" }]) {
    const metadata = info();
    Object.assign(metadata.formats[0], format);
    assert.equal(validateSample(metadata).audioFormat, undefined);
  }
});

test("元信息、字幕解析、实际音频检查及清理独立通过，报告不含日志/字幕/路径", async () => {
  const fake = fixture();
  const report = await checkMedia(fake.dependencies);
  assert.equal(report.media_sample_verified, true);
  assert.equal(report.full_pipeline_verified, false);
  assert.deepEqual(report.checks.map((item) => item.status), ["pass", "pass", "pass", "pass"]);
  for (const call of fake.calls) {
    assert.equal(call.args.at(-1), SAMPLE_URL);
    assert.equal(call.args.some((arg) => arg.startsWith("--cookies")), false);
  }
  const audio = fake.calls[2];
  assert.equal(audio.timeout, 50000);
  assert.equal(audio.args[audio.args.indexOf("--max-filesize") + 1], String(MAX_AUDIO_BYTES));
  assert.equal(audio.args[audio.args.indexOf("--limit-rate") + 1], "128K");
  assert.doesNotMatch(JSON.stringify(report), /private|token|vidsnap-media-smoke/);
  await assert.rejects(fs.access(fake.directory()!));
});

test("没有已知大小的 HTTPS 音轨时跳过下载，不能报告媒体已验收", async () => {
  const fake = fixture({ metadata: { ...info(), formats: [] } });
  const report = await checkMedia(fake.dependencies);
  assert.equal(report.media_sample_verified, false);
  assert.equal(report.checks[2].status, "skip");
  assert.equal(fake.calls.length, 2);
  await assert.rejects(fs.access(fake.directory()!));
});

test("元信息失败、字幕失败、音频失败和探测失败均清理已有产物", async () => {
  for (const fail of ["metadata", "subtitle", "audio", "probe"] as const) {
    const fake = fixture({ fail });
    const report = await checkMedia(fake.dependencies);
    assert.equal(report.media_sample_verified, false);
    assert.equal(report.checks.at(-1)?.status, "pass");
    assert.doesNotMatch(JSON.stringify(report), /private|secret/);
    if (fake.directory()) await assert.rejects(fs.access(fake.directory()!));
    if (fail === "subtitle") assert.equal(report.checks.find((item) => item.id === "audio")?.status, "pass");
  }
});

test("空字幕、异常时间戳和无对应手动字幕不能报告验收成功", async () => {
  for (const subtitle of ["WEBVTT\n", "WEBVTT\n\n00:00:30.000 --> 00:00:32.000\ntext\n"]) {
    const report = await checkMedia(fixture({ subtitle }).dependencies);
    assert.equal(report.checks[1].status, "fail");
    assert.equal(report.media_sample_verified, false);
  }
  const metadata = { ...info(), subtitles: {} };
  const fake = fixture({ metadata });
  const report = await checkMedia(fake.dependencies);
  assert.equal(report.checks[1].status, "skip");
  assert.equal(report.media_sample_verified, false);
  assert.equal(fake.calls.length, 2);
});

test("音频为空/超限/时长不匹配不能报告成功，并清理临时目录", async () => {
  for (const options of [{ audioBytes: 0 }, { audioBytes: MAX_AUDIO_BYTES + 1 }, { duration: "NaN" }, { duration: "40" }]) {
    const fake = fixture(options);
    const report = await checkMedia(fake.dependencies);
    assert.equal(report.checks[2].status, "fail");
    assert.equal(report.media_sample_verified, false);
    await assert.rejects(fs.access(fake.directory()!));
  }
});

test("错误分类区分平台状态、限流、超时和安全拒绝，不回显原始错误", () => {
  for (const [stderr, expected] of [["NetworkPolicyError", "media_policy_rejected"], ["Sign in to confirm you're not a bot", "platform_login_or_challenge"],
    ["HTTP Error 429", "upstream_rate_limited"], ["HTTP Error 403", "upstream_http_403"], ["TimeoutExpired", "stage_timeout"],
    ["SSLERROR", "upstream_tls_failed"], ["private-unrecognized-error", "stage_failed"]]) {
    assert.equal(errorCategory({ stderr }), expected);
  }
  assert.equal(errorCategory({ killed: true }), "stage_timeout");
});
