import childProcess from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { ServerResponse } from "node:http";

// 仅由测试进程显式预加载，所有网络与媒体进程均被替换。
let failure = "";
let pausedStage = "";
let announce = () => {};
let resume = async () => {};
const counts = { metadata: 0, download: 0, vision: 0, summary: 0, followup: 0, embedding: 0 };
const originalExecFile = childProcess.execFile;
const originalFetch = globalThis.fetch;
const originalWriteHead = ServerResponse.prototype.writeHead;

export const mockState = {
  fail(stage = "") { failure = stage; },
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
      if (command === "yt-dlp") {
        if (args.includes("--version")) return { stdout: "2026.01.01", stderr: "" };
        const input = new URL(args.at(-1));
        const videoId = input.searchParams.get("v");
        if (args.includes("--dump-json")) {
          counts.metadata++;
          return { stdout: JSON.stringify({ id: videoId, title: "隔离测试视频", duration: 20, thumbnail: "", uploader: "测试作者" }), stderr: "" };
        }
        counts.download++;
        const template = args[args.indexOf("--output") + 1];
        if (failure === "download") {
          await fs.writeFile(`${template}.part`, "partial");
          throw new Error("模拟下载失败");
        }
        await checkpoint("download");
        if (args.includes("--skip-download")) {
          await fs.writeFile(`${template}.zh-Hans.srt`, "1\n00:00:00,000 --> 00:00:05,000\n这是隔离测试字幕。\n\n2\n00:00:05,000 --> 00:00:10,000\n第二段说明。\n");
        } else {
          await fs.writeFile(template.replace("%(ext)s", template.includes("-video.") ? "mp4" : "m4a"), "mock-media");
        }
        return { stdout: "", stderr: "" };
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
    const body = JSON.parse(options.body);
    if (String(url).endsWith("/embeddings")) {
      counts.embedding++;
      await checkpoint("embedding");
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
