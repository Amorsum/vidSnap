import { loadEnvConfig } from "@next/env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WhisperClient } from "../src/lib/whisper-client";

const execute = promisify(execFile);
type Check = { id: string; status: "pass" | "warn" | "fail" | "skip"; message: string; details: Record<string, unknown> };
type Report = { schema_version: number; checks: Check[]; full_pipeline_verified: boolean; scope: string };

async function localSpeechSmoke(report: Report): Promise<void> {
  const cache = report.checks.find((item) => item.id === "whisper_cache")?.details.models;
  if (!Array.isArray(cache) || !cache.includes("tiny")) {
    report.checks.push({ id: "whisper_smoke", status: "fail", message: "未发现完整 tiny 缓存，不自动下载模型", details: {} });
    return;
  }
  if (process.platform !== "win32") {
    report.checks.push({ id: "whisper_smoke", status: "skip", message: "内置离线语音夹具仅支持 Windows 语音合成", details: {} });
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vidsnap-runtime-"));
  const audio = path.join(directory, "speech.wav");
  const service = new WhisperClient({
    defaultModel: "tiny", timeoutMs: 120000, startupTimeoutMs: 60000,
    async fallback() { throw new Error("本项验收要求常驻握手与推理，不以脚本成功替代"); },
  });
  const previousOffline = process.env.HF_HUB_OFFLINE;
  process.env.HF_HUB_OFFLINE = "1";
  const started = performance.now();
  try {
    const speech = "Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $voice.SetOutputToWaveFile($env:VIDSNAP_SPEECH_PATH); $voice.Speak('This is a short local speech recognition test for Vid Snap.') } finally { $voice.Dispose() }";
    await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", speech], {
      timeout: 20000, windowsHide: true, env: { ...process.env, VIDSNAP_SPEECH_PATH: audio },
    });
    const result = await service.transcribe({ audio_path: audio, model: "tiny", language: "en" });
    const valid = result.text.trim().length > 10 && result.segments.length > 0;
    report.checks.push({ id: "whisper_smoke", status: valid ? "pass" : "fail", message: "真实缓存 tiny + 本机合成语音，验证握手及转写；不输出音频或字幕内容", details: {
      model: "tiny", transport: "persistent", offline: true, nonempty_text: !!result.text.trim(), segments: result.segments.length,
      language: result.language, elapsed_ms: Math.round(performance.now() - started),
    } });
  } catch {
    report.checks.push({ id: "whisper_smoke", status: "fail", message: "本地真实推理未完成；检查语音合成、模型缓存、DLL 或转写预算", details: {} });
  } finally {
    try { await service.close(); }
    finally {
      if (previousOffline === undefined) delete process.env.HF_HUB_OFFLINE;
      else process.env.HF_HUB_OFFLINE = previousOffline;
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = new Set(["--network", "--whisper-smoke", "--json", "--proxy"]);
  for (let index = 0; index < args.length; index++) {
    if (!known.has(args[index])) throw new Error("参数不受支持");
    if (args[index] === "--proxy") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--proxy 需要固定 HTTP 代理地址");
    }
  }
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const proxyIndex = args.indexOf("--proxy");
  if (proxyIndex >= 0) process.env.MEDIA_UPSTREAM_PROXY = args[proxyIndex + 1];
  let raw: string;
  try {
    const result = await execute("python", ["-B", path.join(process.cwd(), "scripts", "runtime_probe.py"), ...(args.includes("--network") ? ["--network"] : [])], {
      timeout: 65000, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });
    raw = result.stdout;
  } catch (error) {
    if (!(error instanceof Error) || !("stdout" in error) || typeof error.stdout !== "string" || !error.stdout) throw new Error("Python 环境检查未完成");
    raw = error.stdout;
  }
  const report: Report = JSON.parse(raw);
  report.checks.unshift({ id: "node", status: "pass", message: "当前 Node 解释器", details: { version: process.versions.node } });
  const provider = process.env.LLM_PROVIDER === "claude" ? "claude" : "deepseek";
  const summaryKeyPresent = !!(provider === "claude" ? process.env.CLAUDE_API_KEY : process.env.DEEPSEEK_API_KEY);
  report.checks.push({ id: "configuration", status: summaryKeyPresent ? "pass" : "warn", message: "只报告当前 Provider 的配置是否存在，不发出模型请求", details: {
    summary_provider: provider, summary_key_present: summaryKeyPresent, cloud_asr_key_present: !!process.env.SENSEVOICE_API_KEY,
    proxy_override: proxyIndex >= 0,
  } });
  if (args.includes("--whisper-smoke")) await localSpeechSmoke(report);
  if (args.includes("--json")) console.log(JSON.stringify(report));
  else for (const item of report.checks) console.log(`[${item.status.toUpperCase()}] ${item.id}: ${item.message} ${JSON.stringify(item.details)}`);
  process.exitCode = report.checks.some((item) => item.status === "fail") ? 1 : 0;
}

main().catch(() => { console.error("运行环境检查未完成，请检查参数、Python 与项目依赖；未输出敏感配置。"); process.exitCode = 1; });
