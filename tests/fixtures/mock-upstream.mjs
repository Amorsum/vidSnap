import childProcess from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { ServerResponse } from "node:http";

// 仅由测试进程显式预加载，所有网络与媒体进程均被替换。
let failure = "";
let asrMode = "";
let pausedStage = "";
let announce = () => {};
let resume = async () => {};
const counts = { metadata: 0, download: 0, vision: 0, summary: 0, followup: 0, embedding: 0, cloud: 0, whisper: 0 };
const originalExecFile = childProcess.execFile;
const originalSpawn = childProcess.spawn;
const originalFetch = globalThis.fetch;
const originalWriteHead = ServerResponse.prototype.writeHead;

export const mockState = {
  fail(stage = "") { failure = stage; },
  asr(mode = "") { asrMode = mode; },
  counts() { return { ...counts }; },
  pauseNext(stage) {
    pausedStage = stage;
    const started = new Promise((resolve) => { announce = () => resolve(); });
    let release = () => {};
    const blocked = new Promise((resolve) => { release = () => resolve(); });
    resume = () => blocked;
    return { started, release };
  },
  restore() {
    childProcess.execFile = originalExecFile;
    childProcess.spawn = originalSpawn;
    globalThis.fetch = originalFetch;
    ServerResponse.prototype.writeHead = originalWriteHead;
  },
};

async function checkpoint(stage) {
  if (pausedStage !== stage) return;
  pausedStage = "";
  announce();
  await resume();
}

export function installMockUpstream() {
  childProcess.spawn = () => { throw new Error("禁止调用真实常驻媒体进程"); };
  ServerResponse.prototype.writeHead = function (...args) {
    this.setHeader("X-Vidsnap-Test-Mocks", "1");
    return originalWriteHead.apply(this, args);
  };
  process.env.ACCESS_CODE = "isolation-test-only";
  process.env.DEEPSEEK_API_KEY = "mock-provider-key";
  process.env.SENSEVOICE_API_KEY = "mock-provider-key";
  process.env.LLM_PROVIDER = "deepseek";
  process.env.VISION_MODEL = "mock-vision";
  delete process.env.VISION_ENABLED;
  const replacement = () => { throw new Error("禁止调用真实媒体进程"); };
  Object.defineProperty(replacement, promisify.custom, {
    value: async (command, args) => {
      if (command === "python" && args[0]?.endsWith("media_network.py") && args[1] === "subtitle") {
        counts.download++;
        await checkpoint("download");
        const output = args[3];
        if (failure === "download") throw new Error("模拟字幕下载失败");
        const content = asrMode === "empty-subtitle" ? "" : asrMode === "invalid-subtitle" ? "not a subtitle"
          : "1\n00:00:00,000 --> 00:00:05,000\n这是隔离测试字幕。\n\n2\n00:00:05,000 --> 00:00:10,000\n第二段说明。\n";
        await fs.writeFile(output, content);
        return { stdout: "", stderr: "" };
      }
      if (command === "python" && args[0]?.endsWith("media_network.py") && args[1] === "yt-dlp") {
        command = "yt-dlp";
        args = args.slice(3);
      }
      if (command === "yt-dlp") {
        if (args.includes("--version")) return { stdout: "2026.01.01", stderr: "" };
        const input = new URL(args.at(-1));
        const videoId = input.searchParams.get("v");
        if (args.includes("--dump-json")) {
          counts.metadata++;
          await checkpoint("metadata");
          const withSubtitle = !asrMode || ["empty-subtitle", "invalid-subtitle"].includes(asrMode);
          const subtitles = withSubtitle ? { "zh-Hans": [{ ext: "srt", url: "https://www.youtube.com/api/timedtext?lang=zh-Hans" }] } : {};
          return { stdout: JSON.stringify({ id: videoId, title: "隔离测试视频", duration: 20, thumbnail: "", uploader: "测试作者", subtitles, automatic_captions: {} }), stderr: "" };
        }
        counts.download++;
        const template = args[args.indexOf("--output") + 1];
        if (failure === "download") {
          await fs.writeFile(`${template}.part`, "partial");
          throw new Error("模拟下载失败");
        }
        await checkpoint("download");
        if (args.includes("--skip-download")) {
          if (asrMode) return { stdout: "", stderr: "" };
          await fs.writeFile(`${template}.zh-Hans.srt`, "1\n00:00:00,000 --> 00:00:05,000\n这是隔离测试字幕。\n\n2\n00:00:05,000 --> 00:00:10,000\n第二段说明。\n");
        } else {
          const output = template.replace("%(ext)s", template.includes("-video.") ? "mp4" : "m4a");
          await fs.writeFile(output, "mock-media");
          return { stdout: JSON.stringify(output) + "\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "python" && args[0]?.endsWith("whisper_asr.py")) {
        counts.whisper++;
        if (asrMode === "local-error") throw new Error("模拟本地转写失败 /private/path");
        const segments = asrMode === "local-empty" ? [] : [{ start: 0, end: 5, text: "本地转写证据" }];
        return { stdout: JSON.stringify({ text: segments.map((segment) => segment.text).join(" "), segments, language: "zh" }), stderr: "" };
      }
      if (command === "ffmpeg") {
        const template = args.at(-1);
        const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
        for (let index = 1; index <= 3; index++) {
          await fs.writeFile(template.replace("%03d", String(index).padStart(3, "0")), Buffer.concat([pixel, Buffer.from(`mock-frame-${index}`)]));
        }
        return { stdout: "", stderr: "" };
      }
      throw new Error(`测试未配置的命令：${command}`);
    },
  });
  Object.defineProperty(childProcess, "execFile", { value: replacement, configurable: true, writable: true });
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/audio/transcriptions")) {
      counts.cloud++;
      return asrMode === "cloud-success" ? Response.json({ text: "云端转写证据。" }) : Response.json({ error: "模拟云端故障" }, { status: 503 });
    }
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/embeddings")) {
      counts.embedding++;
      await checkpoint("embedding");
      if (failure === "embedding") return Response.json({ error: "mock unavailable" }, { status: 503 });
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })) });
    }
    if (typeof body.messages?.[0]?.content !== "string") {
      counts.vision++;
      const prompt = body.messages[0].content[0].text;
      const ids = [...prompt.matchAll(/frameId=(\d+):/g)].map((match) => Number(match[1]));
      // 主模型先返回第二帧，备用模型补齐其余帧，刻意制造非顺序完成。
      const selected = body.model === "mock-vision" ? ids.filter((id) => id === 2) : ids;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ frames: selected.map((frameId) => ({ frameId, description: `第${frameId}帧画面证据` })) }) } }] });
    }
    if (body.stream) {
      counts.summary++;
      await checkpoint("summary");
      if (failure === "summary") return Response.json({ error: "mock error" }, { status: 500 });
      const content = JSON.stringify({ overall: "隔离测试总结", segments: [{ start: 0, end: 10, title: "测试分段", points: [{ time: "00:01", text: "测试要点" }] }] });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    counts.followup++;
    await checkpoint("followup");
    const history = body.messages.filter((message) => message.role === "user").map((message) => message.content).join(" | ");
    return Response.json({ choices: [{ message: { content: `模拟追问回答：${history}` }, finish_reason: "stop" }] });
  };
}

if (process.env.VIDSNAP_TEST_MOCKS === "1") installMockUpstream();
