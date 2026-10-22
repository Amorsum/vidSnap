import { ServerResponse } from "node:http";
import { loadEnvConfig } from "@next/env";

// 仅预加载到隔离副本服务；保留所有真实下载器和模型，不替换网络或媒体进程。
if (process.env.VIDSNAP_LIVE_ACCEPTANCE !== "1") throw new Error("Explicit isolated live acceptance required");
loadEnvConfig(process.env.VIDSNAP_CONFIG_ROOT ?? process.cwd(), false, { info() {}, error() {} });
if ((process.env.LLM_PROVIDER || "deepseek") !== "deepseek") throw new Error("Current streaming acceptance requires DeepSeek");
process.env.VISION_ENABLED = "0";
const writeHead = ServerResponse.prototype.writeHead;
ServerResponse.prototype.writeHead = function (...args) {
  this.setHeader("X-Vidsnap-Live-Acceptance", "text-only");
  return writeHead.apply(this, args);
};
