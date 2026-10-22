import { loadEnvConfig } from "@next/env";
import { checkMedia } from "./media-smoke";

async function main() {
  const args = process.argv.slice(2);
  let proxy: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--json") continue;
    if (args[index] !== "--proxy" || !args[index + 1]) throw new Error("unsupported_argument");
    proxy = args[++index];
    const url = new URL(proxy);
    if (url.protocol !== "http:" || !url.hostname || !["", "/"].includes(url.pathname) || url.search || url.hash) throw new Error("invalid_proxy");
  }
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  if (proxy) process.env.MEDIA_UPSTREAM_PROXY = proxy;
  const report = await checkMedia();
  if (args.includes("--json")) console.log(JSON.stringify(report));
  else {
    console.log("固定 YouTube 短样本验收：不读取 cookies、不调用模型；结果不代表完整分析链路。");
    for (const item of report.checks) console.log(`[${item.status.toUpperCase()}] ${item.id}: ${JSON.stringify(item.details)}`);
  }
  process.exitCode = report.media_sample_verified ? 0 : 1;
}

main().catch(() => { console.error("媒体小样本检查未完成，请检查参数或本地运行环境；未输出原始配置与下载日志。"); process.exitCode = 1; });
