import { readFile, stat, writeFile } from "node:fs/promises";
import { isAnalysisResult } from "../../src/lib/learning";
import { parseNotebookBackup } from "../../src/lib/notebook-backup";
import { prepareEvidenceReview, summarizeEvidenceReview } from "../../src/lib/evidence-review";

async function readInput(file: string) {
  if ((await stat(file)).size > 20 * 1024 * 1024) throw new Error("输入过大");
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error("输入过大");
  return text.replace(/^\uFEFF/, "");
}

async function main() {
  const [mode, input, reviewFile, ...extra] = process.argv.slice(2);
  if (!["prepare", "report"].includes(mode) || !input || !reviewFile || extra.length) throw new Error("参数错误");
  const raw = await readInput(input);
  const parsed: unknown = JSON.parse(raw);
  const analyses = isAnalysisResult(parsed) ? [parsed] : parseNotebookBackup(raw).map(note => note.analysis);
  if (mode === "prepare") {
    const text = JSON.stringify(analyses.map(prepareEvidenceReview), null, 2);
    if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new Error("核查表过大");
    await writeFile(reviewFile, text, { encoding: "utf8", flag: "wx" });
    console.log("核查表已写入指定文件，包含字幕与总结文字；请仅修改 review 字段，不要提交私人内容。");
  } else {
    const worksheets: unknown = JSON.parse(await readInput(reviewFile));
    if (!Array.isArray(worksheets) || worksheets.length !== analyses.length) throw new Error("核查表不完整");
    const reports = analyses.map((analysis, i) => ({ analysisIndex: i, ...summarizeEvidenceReview(analysis, worksheets[i]) }));
    console.log(JSON.stringify({ version: 1, reports }, null, 2));
    if (reports.some(report => !report.complete || report.counts.contradicted || report.counts.insufficient)) process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("核查失败：请检查参数、输入格式、文件大小与核查字段；prepare 不覆盖已有文件。用法：npm run review:evidence -- prepare|report <分析或备份JSON> <核查表JSON>");
  process.exitCode = 2;
});
