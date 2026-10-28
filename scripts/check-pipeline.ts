import { loadEnvConfig } from "@next/env";
import { checkPipeline, localAcceptanceUrl } from "./pipeline-acceptance";

async function main() {
  const args = process.argv.slice(2);
  let base: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--json") continue;
    if (args[index] !== "--base-url" || !args[index + 1]) throw new Error("unsupported_argument");
    base = localAcceptanceUrl(args[++index]);
  }
  if (!base) throw new Error("isolated_server_required");
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const report = await checkPipeline(base);
  console.log(args.includes("--json") ? JSON.stringify(report) : JSON.stringify(report, null, 2));
  process.exitCode = report.text_api_pipeline_verified ? 0 : 1;
}

main().catch(() => { console.error("完整文字 API 验收未完成：需专用环回端口及显式 live 验收服务，不输出配置或原始响应。"); process.exitCode = 1; });
