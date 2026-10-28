/**
 * 关键帧视觉理解：硅基流动 Qwen3-VL 批量画面描述（多模态）
 * 设计原则：任何失败（无 key / 401 / 超时 / 解析失败）一律降级为音频-only，绝不阻塞主流程
 */
import fs from "fs/promises";
import type { TokenUsage } from "./llm";
import { formatTime } from "./prompts";
import { randomBytes } from "node:crypto";
import type { Keyframe } from "./keyframes";
import { VisionBudget, VisionBudgetExceeded } from "./vision-budget";
import { setTimeout as delay } from "node:timers/promises";

const VISION_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
// 2026-08-31 实测：硅基流动已下线 Qwen2.5-VL 系列，账号可用视觉模型为 Qwen3-VL 系列（32B/30B-A3B/8B）
const DEFAULT_VISION_MODEL = "Qwen/Qwen3-VL-32B-Instruct";
// 降级链：主模型高峰期队列不稳（实测 500/超时），失败帧换备选模型补齐（各自独立队列）
const VISION_MODEL_FALLBACKS = [
  "Qwen/Qwen3-VL-30B-A3B-Instruct",
  "Qwen/Qwen3-VL-8B-Instruct",
];
const FRAME_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 与帧文件 TTL 一致
const runtime = globalThis as typeof globalThis & { vidsnapFrameSecret?: string };
const fallbackSigningSecret = runtime.vidsnapFrameSecret ??= randomBytes(32).toString("hex");

export interface FrameDescription {
  frameId: number;
  time: number; // 秒
  description: string;
}

/** 关键帧元数据（随 result 事件与缓存返回前端） */
export interface FrameInfo {
  time: number;
  src: string;
  description: string;
}

export interface VisionResult {
  descriptions: FrameDescription[];
  usage: TokenUsage | null;
  outcome: "completed" | "partial" | "budget_exhausted" | "failed";
  /** 仅汇总实际返回的 usage；超时或缺 usage 的请求无法确认消耗。 */
  usageComplete: boolean;
}

/** 视觉理解是否启用：VISION_ENABLED=0 显式关闭，否则要求硅基流动 key（与转写/embedding 同 key） */
export function isVisionEnabled(): boolean {
  if (process.env.VISION_ENABLED === "0") return false;
  return !!process.env.SENSEVOICE_API_KEY;
}

/**
 * 每批最多 4 帧；读取、响应正文和重试等待共用阶段剩余预算。
 * 单批失败保留其他批结果，已返回的 usage 不因描述解析失败丢失。
 */
async function describeWithModel(
  frames: Keyframe[],
  videoTitle: string | undefined,
  model: string,
  apiKey: string,
  budget: VisionBudget,
): Promise<{ descriptions: FrameDescription[]; usage: TokenUsage[]; requests: number; timedOut: boolean }> {
  // 每批最多 4 帧：小请求在高峰期排队时间短、失败影响面小；
  // 单批失败跳过保留其他批（部分画面描述 > 全无）
  const BATCH_SIZE = 4;
  const descriptions: FrameDescription[] = [];
  const usages: TokenUsage[] = [];
  let requests = 0;
  let timedOut = false;

  for (let i = 0; i < frames.length; i += BATCH_SIZE) {
    if (budget.exhausted) { timedOut = true; break; }
    const chunk = frames.slice(i, i + BATCH_SIZE);
    try {
      const data = await budget.run(async (signal) => {
        // 480px 宽 + q:v 4 下每帧约 30-60KB，4 帧请求体约 150-250KB
        const imageContents = await Promise.all(
          chunk.map(async (f) => {
            const buf = await fs.readFile(f.path, { signal });
            return {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
            };
          })
        );

        const timeHints = chunk.map((f) => `frameId=${f.frameId}: ${Math.round(f.time)}秒`).join("、");
        const promptText = `视频标题：${videoTitle ?? "未知"}
以下是从该视频不同时间点截取的 ${chunk.length} 张画面（按时间顺序，对应秒数分别为：${timeHints}）。
请逐张分析画面内容（场景/人物/正在演示或展示的内容/屏幕文字与图表），每张用一句中文描述（15-40 字），并把描述绑定到对应的画面时间。
输出 JSON，格式：{"frames":[{"frameId": 输入的frameId, "time": 秒数, "description": "描述"}]}，每条描述必须绑定输入的 frameId，不重新编号。`;

        const body = {
          model,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: promptText }, ...imageContents],
            },
          ],
          max_tokens: 2000,
          temperature: 0.3,
          response_format: { type: "json_object" },
        };

        const request = async () => {
          signal.throwIfAborted();
          budget.remainingMs();
          requests++;
          return fetch(VISION_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
          });
        };
        let response = await request();

        // 瞬时服务端错误（500/502/503/429）延时重试一次：实测偶发 500，重试可救回
        if (!response.ok && [429, 500, 502, 503].includes(response.status)) {
          await response.body?.cancel();
          // 连重试等待都无法容纳时，不再占住剩余预算或切到另一个模型。
          budget.remainingMs(2001);
          console.log(`[vision] ${model} API ${response.status}，在剩余预算内重试一次`);
          await delay(2000, undefined, { signal });
          response = await request();
        }

        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`SiliconFlow 视觉 API 错误 (${response.status})`);
        }

        return response.json();
      });
      const usage = data.usage;
      if (usage && [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) {
        usages.push({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens, cacheHitTokens: 0 });
      }
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("视觉响应无内容");

      // 模型可能返回多种结构，做兼容解析：
      // 1) {"frames":[{"description":...}]} 预期形态
      // 2) {"<秒>": "描述", ...} —— Qwen3-VL 实测按输入的时间提示作键
      // 3) {"description"/"image_description": "..."} 单图兜底
      const parsed = JSON.parse(content) as Record<string, unknown>;

      const rawList = Array.isArray(parsed.frames) ? parsed.frames : null;
      let chunkDescCount = 0;
      if (rawList) {
        rawList.forEach((item, j) => {
          if (!item || typeof item !== "object") return;
          const text = item.description ?? item.text;
          const desc = typeof text === "string" ? text.trim() : "";
          const f = item.frameId !== undefined ? chunk.find((frame) => frame.frameId === item.frameId)
            : typeof item.time === "number" ? chunk.find((frame) => Math.abs(frame.time - item.time) <= 0.5)
            : rawList.length === chunk.length ? chunk[j] : undefined;
          if (f && desc && !descriptions.some((description) => description.frameId === f.frameId)) {
            descriptions.push({ frameId: f.frameId, time: f.time, description: desc });
            chunkDescCount++;
          }
        });
      } else {
        // 时间键映射：键为秒数（模型按输入的时间提示生成），匹配最近帧（±2s 内）
        const timeKeyEntries = Object.entries(parsed).filter(
          ([k, v]) => typeof v === "string" && /^\d+(\.\d+)?$/.test(k)
        );
        for (const [key, value] of timeKeyEntries) {
          const t = Number(key);
          const desc = (value as string).trim();
          if (!desc) continue;
          let best = chunk[0];
          for (const f of chunk) {
            if (Math.abs(f.time - t) < Math.abs(best.time - t)) best = f;
          }
          if (Math.abs(best.time - t) > 2) continue; // 超出容差的异常键，丢弃
          if (descriptions.some((description) => description.frameId === best.frameId)) continue;
          descriptions.push({ frameId: best.frameId, time: best.time, description: desc });
          chunkDescCount++;
        }
        // 单图兜底形态（按批判断，多批场景下前面批的结果不影响本批）
        if (chunkDescCount === 0 && chunk.length === 1) {
          const singleDesc = (parsed.description || parsed.image_description) as string | undefined;
          if (typeof singleDesc === "string" && singleDesc.trim()) {
            descriptions.push({ frameId: chunk[0].frameId, time: chunk[0].time, description: singleDesc.trim() });
            chunkDescCount++;
          }
        }
      }
      if (chunkDescCount === 0) {
        console.log("[vision] 批次响应未匹配预期结构:", JSON.stringify(parsed).slice(0, 200));
      }

    } catch (err) {
      if (err instanceof VisionBudgetExceeded || budget.exhausted) { timedOut = true; break; }
      // 单批失败跳过，保留其他批的描述和已取得的 usage。
      console.log(`[vision] ${model} 第 ${i / BATCH_SIZE + 1} 批失败，跳过该批`);
    }
  }

  return { descriptions, usage: usages, requests, timedOut };
}

/**
 * 单次批量调用视觉模型描述全部关键帧（含模型降级链）
 * 无帧/无 key 返回 null；其余返回实际覆盖、可确认的 usage 和降级状态。
 */
export async function describeFrames(
  frames: Keyframe[],
  videoTitle?: string,
  budget = new VisionBudget(),
): Promise<VisionResult | null> {
  if (frames.length === 0) return null;

  const apiKey = process.env.SENSEVOICE_API_KEY;
  if (!apiKey) return null;

  // 模型链：主模型（可用 VISION_MODEL 覆盖）→ 30B-A3B → 8B；上一模型未覆盖的帧交给下一模型补齐
  const primary = process.env.VISION_MODEL || DEFAULT_VISION_MODEL;
  const chain = [primary, ...VISION_MODEL_FALLBACKS.filter((m) => m !== primary)];

  const descriptions: FrameDescription[] = [];
  const usages: TokenUsage[] = [];
  let requests = 0;
  let timedOut = false;

  for (const model of chain) {
    const coveredFrames = new Set(descriptions.map((d) => d.frameId));
    const missing = frames.filter((f) => !coveredFrames.has(f.frameId));
    if (missing.length === 0) break;
    if (budget.exhausted) { timedOut = true; break; }

    const result = await describeWithModel(missing, videoTitle, model, apiKey, budget);
    descriptions.push(...result.descriptions);
    usages.push(...result.usage);
    requests += result.requests;
    if (result.timedOut) { timedOut = true; break; }
    if (result.descriptions.length > 0) {
      console.log(`[vision] ${model} 覆盖 ${result.descriptions.length}/${missing.length} 帧`);
    } else {
      console.log(`[vision] ${model} 全部批次失败，尝试降级模型`);
    }
  }

  if (descriptions.length === 0) {
    console.log("[vision] 模型链全部失败，降级为音频-only");
  }
  if (descriptions.length < frames.length) {
    console.log(`[vision] 模型链部分覆盖: ${descriptions.length}/${frames.length} 帧`);
  }

  // 汇总多模型多批 usage
  const usage: TokenUsage | null = usages.length
    ? usages.reduce((acc, u) => ({
        promptTokens: acc.promptTokens + u.promptTokens,
        completionTokens: acc.completionTokens + u.completionTokens,
        totalTokens: acc.totalTokens + u.totalTokens,
        cacheHitTokens: acc.cacheHitTokens + u.cacheHitTokens,
      }))
    : null;

  const outcome = timedOut ? "budget_exhausted" : descriptions.length === frames.length ? "completed" : descriptions.length > 0 ? "partial" : "failed";
  return { descriptions: descriptions.sort((a, b) => a.time - b.time), usage, outcome, usageComplete: requests === usages.length };
}

/**
 * 把视觉描述格式化为融合进总结 prompt 的文本块
 */
export function formatFramePrompt(descriptions: FrameDescription[]): string {
  return descriptions
    .map((d) => `[${formatTime(d.time)}] 画面：${d.description}`)
    .join("\n");
}

// ─── 帧图片访问 token（图片 URL 无法带自定义 header，改用 HMAC 签名） ───

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 帧图访问 token：`<expMs>.<hmac(videoId:idx:expMs)>`，2 小时过期 */
export async function signFrameToken(videoId: string, idx: number, expiresAt = Date.now() + FRAME_TOKEN_TTL_MS): Promise<string> {
  const secret = fallbackSigningSecret;
  const expMs = Math.min(expiresAt, Date.now() + FRAME_TOKEN_TTL_MS);
  const sig = await hmacHex(secret, `${videoId}:${idx}:${expMs}`);
  return `${expMs}.${sig}`;
}

/** 校验帧图访问 token（签名 + 过期时间） */
export async function verifyFrameToken(token: string, videoId: string, idx: number): Promise<boolean> {
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return false;
  const expMs = Number(token.slice(0, dotIdx));
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const secret = fallbackSigningSecret;
  const expected = await hmacHex(secret, `${videoId}:${idx}:${expMs}`);
  return expected === token.slice(dotIdx + 1);
}
