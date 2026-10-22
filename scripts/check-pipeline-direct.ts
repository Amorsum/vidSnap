import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { loadEnvConfig } from "@next/env";

async function checkDownload(directory: string) {
  const { getProcessor } = await import("../src/lib/platforms");
  const { downloadAudio } = await import("../src/lib/video-processor");
  const { parseBuiltinSubtitle } = await import("../src/lib/transcriber");
  const id = "jNQXAC9IVRw";
  const url = `https://www.youtube.com/watch?v=${id}`;
  const processor = getProcessor(url);
  const started = performance.now();
  const info = await processor.getInfo(url);
  if (info.id !== id || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 30) throw new Error("sample_metadata_rejected");
  const metadataMs = Math.round(performance.now() - started);
  const media = path.join(directory, "download");
  await fs.mkdir(media);
  const subtitleStarted = performance.now();
  const result = await processor.download(url, info, media);
  const subtitleMs = Math.round(performance.now() - subtitleStarted);
  const transcript = result.subtitlePath ? await parseBuiltinSubtitle(result.subtitlePath) : undefined;
  const subtitleBytes = result.subtitlePath ? (await fs.stat(result.subtitlePath)).size : 0;
  const audioStarted = performance.now();
  const audio = await downloadAudio(url, info, media);
  const audioBytes = (await fs.stat(audio.audioPath)).size;
  const valid = !!transcript?.segments.length && audioBytes > 0 && audioBytes <= 8 * 1024 * 1024;
  return { schema_version: 1, scope: "live_youtube_download", sample_id: id, full_pipeline_verified: false,
    media_sample_verified: valid, model_requests: 0, metadata_ms: metadataMs,
    subtitle: { elapsed_ms: subtitleMs, bytes: subtitleBytes, segments: transcript?.segments.length ?? 0, selection: result.subtitle },
    audio: { elapsed_ms: Math.round(performance.now() - audioStarted), bytes: audioBytes, extension: path.extname(audio.audioPath) } };
}

async function main() {
  const root = process.cwd();
  const args = process.argv.slice(2);
  let workspace: string | undefined;
  let proxy: string | undefined;
  const mediaOnly = args.includes("--media-only");
  for (let index = 0; index < args.length; index++) {
    if (["--json", "--media-only"].includes(args[index])) continue;
    const name = args[index];
    const value = args[++index];
    if (!value || !["--workspace", "--proxy"].includes(name)) throw new Error("unsupported_argument");
    if (name === "--workspace") workspace = value;
    else proxy = value;
  }
  if (!workspace) throw new Error("isolated_workspace_required");
  const allowed = await fs.realpath(path.join(root, "tmp"));
  workspace = await fs.realpath(workspace);
  if (!workspace.startsWith(allowed + path.sep)) throw new Error("workspace_outside_tmp");
  await fs.access(path.join(workspace, "scripts", "media_network.py"));
  loadEnvConfig(root, false, { info() {}, error() {} });
  if (!mediaOnly && ((process.env.LLM_PROVIDER || "deepseek") !== "deepseek" || !process.env.DEEPSEEK_API_KEY)) throw new Error("deepseek_streaming_configuration_required");
  if (proxy) {
    const value = new URL(proxy);
    if (value.protocol !== "http:" || !value.hostname || !["", "/"].includes(value.pathname) || value.search || value.hash) throw new Error("invalid_proxy");
    process.env.MEDIA_UPSTREAM_PROXY = proxy;
  }
  const temporary = await fs.mkdtemp(path.join(workspace, "route-acceptance-"));
  const copiedCookie = path.join(workspace, "cookies.txt");
  let ownsCookie = false;
  const originalConsole = { log: console.log, error: console.error, warn: console.warn };
  let report: unknown;
  try {
    // 临时目录在导入生产模块前隔离，避免到期扫尾扫描现有服务的媒体目录。
    process.env.TEMP = temporary;
    process.env.TMP = temporary;
    process.env.TMPDIR = temporary;
    process.env.VISION_ENABLED = "0";
    // 本项要求显式项目 Cookie 副本；缺失时停止，避免应用的 Firefox 回退读取浏览器数据库。
    await fs.copyFile(path.join(root, "cookies.txt"), copiedCookie, constants.COPYFILE_EXCL);
    ownsCookie = true;
    process.chdir(workspace);
    // 此独立进程抑制生产原始日志，最终只输出白名单诊断字段，不保存字幕/上游异常。
    console.log = console.error = console.warn = () => {};
    if (mediaOnly) {
      const result = await checkDownload(temporary);
      report = result;
      process.exitCode = result.media_sample_verified ? 0 : 1;
    } else {
      const { NextRequest } = await import("next/server");
      const processRoute = await import("../src/app/api/process/route");
      const followupRoute = await import("../src/app/api/followup/route");
      const verifyRoute = await import("../src/app/api/verify/route");
      const { checkPipeline } = await import("./pipeline-acceptance");
      const adapter: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/") return new Response("", { headers: { "x-vidsnap-live-acceptance": "text-only" } });
        const request = new NextRequest(new Request(url, init));
        let response: Response;
        if (url.pathname === "/api/verify") response = await verifyRoute.POST(request);
        else if (url.pathname === "/api/followup") response = await followupRoute.POST(request);
        else if (url.pathname === "/api/process") response = init?.method === "DELETE" ? await processRoute.DELETE(request) : await processRoute.POST(request);
        else throw new Error("unexpected_acceptance_route");
        response.headers.set("x-vidsnap-live-acceptance", "text-only");
        return response;
      };
      // 地址仅构造 NextRequest / Origin，不建立 HTTP 连接或监听端口。
      const result = await checkPipeline("http://127.0.0.1:3419", process.env.ACCESS_CODE ?? "", adapter);
      result.checks[0].details = { transport: "in_process_route_handlers", http_listener: false, mock_upstream: false, text_only: true };
      report = { ...result, scope: "live_text_route_handlers", transport: "in_process_route_handlers" };
      process.exitCode = result.text_api_pipeline_verified ? 0 : 1;
    }
  } finally {
    try {
      const { getWhisperClient } = await import("../src/lib/whisper-client");
      await getWhisperClient().close();
    } finally {
      Object.assign(console, originalConsole);
      process.chdir(root);
      if (ownsCookie) await fs.unlink(copiedCookie);
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  console.log(args.includes("--json") ? JSON.stringify(report) : JSON.stringify(report, null, 2));
}

main().catch(() => { console.error("隔离链路检查未完成，请核对独立副本、配置及临时资源；未输出原始响应或敏感配置。"); process.exitCode = 1; });
