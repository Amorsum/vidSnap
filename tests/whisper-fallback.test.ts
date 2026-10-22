import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const originalExecFile = childProcess.execFile;
const actualExecFile = promisify(originalExecFile);
let WhisperClient: typeof import("../src/lib/whisper-client").WhisperClient;
let optionsSeen: { timeout: number; killSignal: string } | undefined;
const fixture = path.join(process.cwd(), "tests", "fixtures", "whisper-fallback.mjs");

before(async () => {
  const replacement = () => { throw new Error("禁止启动真实 Whisper"); };
  Object.defineProperty(replacement, promisify.custom, {
    value: async (command: string, args: string[], options: { timeout: number; killSignal: NodeJS.Signals }) => {
      assert.equal(command, "python");
      assert.equal(path.basename(args[0]), "whisper_asr.py");
      optionsSeen = options;
      return actualExecFile(process.execPath, [fixture, args[1]], options);
    },
  });
  Object.defineProperty(childProcess, "execFile", { value: replacement, configurable: true, writable: true });
  ({ WhisperClient } = await import("../src/lib/whisper-client"));
});
after(() => { childProcess.execFile = originalExecFile; });

test("默认脚本执行器解析 UTF-8 JSON，参数带预算和强制退出信号", async () => {
  const service = new WhisperClient({ timeoutMs: 1500, spawnWorker() { throw new Error("fixture unavailable"); } });
  try {
    assert.equal((await service.transcribe({ audio_path: "normal", model: "tiny" })).text, "脚本中文🚀");
    assert.ok(optionsSeen && optionsSeen.timeout <= 1500);
    assert.equal(optionsSeen.killSignal, "SIGKILL");
  } finally { await service.close(); }
});

test("脚本非零退出与无效结构只返回安全错误，后续任务仍能执行", async () => {
  const service = new WhisperClient({ timeoutMs: 1500, spawnWorker() { throw new Error("fixture unavailable"); } });
  try {
    for (const audio_path of ["error", "invalid"]) {
      await assert.rejects(service.transcribe({ audio_path, model: "tiny" }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /private|internal/);
        return true;
      });
    }
    assert.equal((await service.transcribe({ audio_path: "normal", model: "tiny" })).text, "脚本中文🚀");
  } finally { await service.close(); }
});

test("真实兜底子进程卡住时按总预算结束，不阻塞后续任务", async () => {
  const service = new WhisperClient({ timeoutMs: 600, spawnWorker() { throw new Error("fixture unavailable"); } });
  try {
    await assert.rejects(service.transcribe({ audio_path: "hang", model: "tiny" }), /超时/);
    assert.equal((await service.transcribe({ audio_path: "normal", model: "tiny" })).text, "脚本中文🚀");
  } finally { await service.close(); }
});
