import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAnalysisResult } from "../../src/lib/learning";
import { auditCitations } from "../../src/lib/citation-audit";
import { parseNotebookBackup } from "../../src/lib/notebook-backup";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("--")) throw new Error("参数错误");
  const file = await stat(args[0]);
  if (!file.isFile() || file.size > 20 * 1024 * 1024) throw new Error("文件无效");
  const input = await readFile(args[0]);
  if (input.length > 20 * 1024 * 1024) throw new Error("文件过大");
  const raw = input.toString("utf8").replace(/^\uFEFF/, "");
  const parsed: unknown = JSON.parse(raw);
  const analyses = isAnalysisResult(parsed) ? [parsed] : parseNotebookBackup(raw).map(note => note.analysis);
  const reports = analyses.map((analysis, analysisIndex) => ({ analysisIndex, ...auditCitations(analysis) }));
  // 不归档正文、会话、帧 URL 或输入路径；指纹用于确认被评测的数据版本。
  console.log(JSON.stringify({ version: 1, reports, inputSha256: createHash("sha256").update(input).digest("hex") }, null, 2));
  if (reports.some(report => report.emptySummary || report.flaggedPoints || report.flaggedChapters)) process.exitCode = 1;
}

main().catch(() => {
  console.error("引用检查失败：请提供一个不超过 20 MiB 的分析结果或笔记备份 JSON 文件。用法：npm run check:citations -- <文件路径>");
  process.exitCode = 2;
});
