/**
 * VidSnap 总结质量评测（A3）
 * 用法：npx tsx scripts/eval/summarize-eval.ts
 *
 * 评测「字幕 → 总结」这一步的 LLM 质量：
 *   1. 对每个 fixture 跑真实总结（复用 SUMMARIZE_SYSTEM_PROMPT + callLLMStreaming）
 *   2. LLM-as-judge 判定幻觉：总结里哪些要点在原文找不到依据
 *   3. LLM-as-judge 判定召回：人工标注的参考要点被覆盖了几个
 *   4. 汇总输出幻觉率 + 要点召回率
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { SUMMARIZE_SYSTEM_PROMPT } from "../../src/lib/prompts";
import { callLLMStreaming, callLLMWithPrompt } from "../../src/lib/llm";

// ─── 加载 .env.local 到 process.env（tsx 不自动加载，需手动）───
function loadEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

interface Fixture {
  id: string;
  title: string;
  uploader: string;
  duration: number;
  transcript: string;
  referencePoints: string[];
}

interface SummaryResult {
  overall: string;
  videoType?: string;
  segments: { title: string; start: number; end: number; points: { time: string; text: string }[] }[];
}

function parseJSON<T>(text: string): T {
  const trimmed = text.trim();
  const md = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const raw = md ? md[1].trim() : trimmed;
  return JSON.parse(raw) as T;
}

// ─── 跑总结（复用真实 prompt + 真实流式调用）───
async function summarize(fixture: Fixture): Promise<SummaryResult> {
  const durationMin = Math.round(fixture.duration / 60);
  const userMessage = `视频标题：${fixture.title}
视频时长：${fixture.duration}秒（约${durationMin}分钟）
上传者：${fixture.uploader}

以下是视频字幕（带时间戳）：

${fixture.transcript}`;

  let fullText = "";
  for await (const chunk of callLLMStreaming(SUMMARIZE_SYSTEM_PROMPT, userMessage, {
    maxTokens: 4000,
    jsonMode: true,
  })) {
    fullText += chunk;
  }
  return parseJSON<SummaryResult>(fullText);
}

function extractPoints(summary: SummaryResult): string[] {
  const points: string[] = [];
  for (const seg of summary.segments || []) {
    for (const p of seg.points || []) {
      points.push(p.text);
    }
  }
  return points;
}

// ─── Judge prompts ───

const HALLUCINATION_JUDGE_PROMPT = `你是一个严格的视频总结质量评估器。下面是视频的完整字幕原文，以及一份 AI 生成的总结要点列表（JSON 数组）。

请逐个判断每个总结要点【是否能在字幕原文中找到依据】。
- 若某要点在原文中完全找不到对应内容、明显编造或张冠李戴，判定为"幻觉"。
- 语义等价（换一种说法但意思一致）不算幻觉。

请严格输出 JSON，不要输出其他内容：
{"hallucinated": [{"text": "被判为幻觉的要点原文", "reason": "一句话说明为什么没有依据"}]}

如果没有幻觉，输出 {"hallucinated": []}`;

const RECALL_JUDGE_PROMPT = `你是一个视频总结质量评估器。下面是 AI 生成的总结要点列表（JSON 数组），以及人工标注的【参考要点】列表（JSON 数组）。

请逐个判断每个【参考要点】是否被总结覆盖。语义等价即可（不要求逐字一致）。

请严格输出 JSON，不要输出其他内容：
{"covered": ["被覆盖的参考要点原文"], "missed": ["未被覆盖的参考要点原文"]}`;

async function judgeHallucination(transcript: string, points: string[]): Promise<string[]> {
  const userMessage = `字幕原文：
${transcript}

总结要点列表：
${JSON.stringify(points, null, 2)}`;

  const text = await callLLMWithPrompt(HALLUCINATION_JUDGE_PROMPT, userMessage, {
    maxTokens: 2000,
    jsonMode: true,
  });
  const result = parseJSON<{ hallucinated: { text: string; reason: string }[] }>(text);
  return result.hallucinated.map((h) => h.text);
}

async function judgeRecall(
  points: string[],
  referencePoints: string[]
): Promise<{ covered: string[]; missed: string[] }> {
  const userMessage = `总结要点列表：
${JSON.stringify(points, null, 2)}

参考要点列表：
${JSON.stringify(referencePoints, null, 2)}`;

  const text = await callLLMWithPrompt(RECALL_JUDGE_PROMPT, userMessage, {
    maxTokens: 2000,
    jsonMode: true,
  });
  return parseJSON<{ covered: string[]; missed: string[] }>(text);
}

function loadFixtures(): Fixture[] {
  const dir = path.join(process.cwd(), "scripts/eval/fixtures");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as Fixture);
}

// ─── 主流程 ───
async function main(): Promise<void> {
  loadEnv();
  const fixtures = loadFixtures();
  console.log(`=== VidSnap 总结质量评测 ===`);
  console.log(`fixtures: ${fixtures.length} 条\n`);

  let totalPoints = 0;
  let totalHallucinated = 0;
  let totalRef = 0;
  let totalCovered = 0;
  const perFixture: Record<string, string | number>[] = [];

  for (const fixture of fixtures) {
    console.log(`--- ${fixture.id} ---`);

    const summary = await summarize(fixture);
    const points = extractPoints(summary);
    console.log(`  summary points: ${points.length}`);

    const hallucinated = await judgeHallucination(fixture.transcript, points);
    console.log(`  hallucinated: ${hallucinated.length}`);
    for (const h of hallucinated) console.log(`    - ${h}`);

    const { covered, missed } = await judgeRecall(points, fixture.referencePoints);
    console.log(`  reference: ${fixture.referencePoints.length}, covered: ${covered.length}, missed: ${missed.length}`);
    for (const m of missed) console.log(`    MISS: ${m}`);

    totalPoints += points.length;
    totalHallucinated += hallucinated.length;
    totalRef += fixture.referencePoints.length;
    totalCovered += covered.length;

    perFixture.push({
      id: fixture.id,
      points: points.length,
      hallucinated: hallucinated.length,
      "hallucinationRate(%)": points.length ? +((hallucinated.length / points.length) * 100).toFixed(1) : 0,
      reference: fixture.referencePoints.length,
      covered: covered.length,
      "recall(%)": fixture.referencePoints.length ? +((covered.length / fixture.referencePoints.length) * 100).toFixed(1) : 0,
    });
  }

  console.log(`\n=== 汇总报告 ===`);
  console.table(perFixture);

  const hallucinationRate = totalPoints ? (totalHallucinated / totalPoints) * 100 : 0;
  const recall = totalRef ? (totalCovered / totalRef) * 100 : 0;
  console.log(`\n总要点数: ${totalPoints}`);
  console.log(`总幻觉数: ${totalHallucinated}`);
  console.log(`总参考要点: ${totalRef}`);
  console.log(`总覆盖数: ${totalCovered}`);
  console.log(`\n幻觉率: ${hallucinationRate.toFixed(1)}% (越低越好)`);
  console.log(`要点召回率: ${recall.toFixed(1)}% (越高越好)`);
}

main().catch((err) => {
  console.error("评测失败:", err);
  process.exit(1);
});
