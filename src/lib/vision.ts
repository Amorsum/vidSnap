/**
 * 关键帧视觉理解：硅基流动 Qwen2.5-VL 批量画面描述（多模态）
 * 设计原则：任何失败（无 key / 401 / 超时 / 解析失败）一律降级为音频-only，绝不阻塞主流程
 */
import fs from "fs/promises";
import type { TokenUsage } from "./llm";
import { formatTime } from "./prompts";

const VISION_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
// 2026-08-31 实测：硅基流动已下线 Qwen2.5-VL 系列，账号可用视觉模型为 Qwen3-VL 系列（32B/30B-A3B/8B）
const DEFAULT_VISION_MODEL = "Qwen/Qwen3-VL-32B-Instruct";
const FRAME_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 与帧文件 TTL 一致

export interface FrameDescription {
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
}

/** 视觉理解是否启用：VISION_ENABLED=0 显式关闭，否则要求硅基流动 key（与转写/embedding 同 key） */
export function isVisionEnabled(): boolean {
  if (process.env.VISION_ENABLED === "0") return false;
  return !!process.env.SENSEVOICE_API_KEY;
}

/**
 * 单次批量调用视觉模型描述全部关键帧
 * 返回 null 表示降级（调用方走音频-only 流程）
 */
export async function describeFrames(
  frames: { path: string; time: number }[],
  videoTitle?: string
): Promise<VisionResult | null> {
  if (frames.length === 0) return null;

  const apiKey = process.env.SENSEVOICE_API_KEY;
  if (!apiKey) return null;

  // 每批最多 4 帧：小请求在高峰期排队时间短、失败影响面小；
  // 单批失败跳过保留其他批（部分画面描述 > 全无）
  const BATCH_SIZE = 4;
  const descriptions: FrameDescription[] = [];
  const usages: TokenUsage[] = [];

  for (let i = 0; i < frames.length; i += BATCH_SIZE) {
    const chunk = frames.slice(i, i + BATCH_SIZE);
    try {
      // 480px 宽 + q:v 4 下每帧约 30-60KB，4 帧请求体约 150-250KB
      const imageContents = await Promise.all(
        chunk.map(async (f) => {
          const buf = await fs.readFile(f.path);
          return {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
          };
        })
      );

      const timeHints = chunk.map((f) => Math.round(f.time)).join("、");
      const promptText = `视频标题：${videoTitle ?? "未知"}
以下是从该视频不同时间点截取的 ${chunk.length} 张画面（按时间顺序，对应秒数分别为：${timeHints}）。
请逐张分析画面内容（场景/人物/正在演示或展示的内容/屏幕文字与图表），每张用一句中文描述（15-40 字），并把描述绑定到对应的画面时间。
输出 JSON，格式：{"frames":[{"time": 秒数, "description": "描述"}]}，frames 数组长度与输入图片数一致，按图片顺序排列。`;

      const body = {
        model: process.env.VISION_MODEL || DEFAULT_VISION_MODEL,
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

      let response = await fetch(VISION_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });

      // 瞬时服务端错误（500/502/503/429）重试一次：实测偶发 500，重试可救回
      if (!response.ok && [429, 500, 502, 503].includes(response.status)) {
        const retryBody = await response.text().catch(() => "");
        console.log(`[vision] 视觉 API ${response.status}，重试一次:`, retryBody.slice(0, 200));
        response = await fetch(VISION_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90000),
        });
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`SiliconFlow 视觉 API 错误 (${response.status}): ${errorBody.slice(0, 300)}`);
      }

      const data = await response.json();
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
        // 返回条数可能少于输入，按索引回填；空描述直接丢弃
        chunk.forEach((f, j) => {
          const item = rawList[j] as { description?: string; text?: string } | undefined;
          const desc = (item?.description || item?.text || "").trim();
          if (desc) {
            descriptions.push({ time: f.time, description: desc });
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
          descriptions.push({ time: best.time, description: desc });
          chunkDescCount++;
        }
        // 单图兜底形态（按批判断，多批场景下前面批的结果不影响本批）
        if (chunkDescCount === 0) {
          const singleDesc = (parsed.description || parsed.image_description) as string | undefined;
          if (typeof singleDesc === "string" && singleDesc.trim()) {
            descriptions.push({ time: chunk[0].time, description: singleDesc.trim() });
            chunkDescCount++;
          }
        }
      }
      if (chunkDescCount === 0) {
        console.log("[vision] 批次响应未匹配预期结构:", JSON.stringify(parsed).slice(0, 200));
      }

      if (data.usage) {
        usages.push({
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
          cacheHitTokens: data.usage.prompt_cache_hit_tokens || 0,
        });
      }
    } catch (err) {
      // 单批失败跳过，保留其他批结果；全部失败时整体降级
      console.log(`[vision] 第 ${i / BATCH_SIZE + 1} 批视觉理解失败，跳过该批:`, err);
    }
  }

  if (descriptions.length === 0) {
    console.log("[vision] 所有批次均失败，降级为音频-only");
    return null;
  }

  // 汇总多批 usage
  const usage: TokenUsage | null = usages.length
    ? usages.reduce((acc, u) => ({
        promptTokens: acc.promptTokens + u.promptTokens,
        completionTokens: acc.completionTokens + u.completionTokens,
        totalTokens: acc.totalTokens + u.totalTokens,
        cacheHitTokens: acc.cacheHitTokens + u.cacheHitTokens,
      }))
    : null;

  return { descriptions, usage };
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
export async function signFrameToken(videoId: string, idx: number): Promise<string> {
  const secret = process.env.ACCESS_CODE || process.env.SENSEVOICE_API_KEY || "vidsnap-frames";
  const expMs = Date.now() + FRAME_TOKEN_TTL_MS;
  const sig = await hmacHex(secret, `${videoId}:${idx}:${expMs}`);
  return `${expMs}.${sig}`;
}

/** 校验帧图访问 token（签名 + 过期时间） */
export async function verifyFrameToken(token: string, videoId: string, idx: number): Promise<boolean> {
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return false;
  const expMs = Number(token.slice(0, dotIdx));
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const secret = process.env.ACCESS_CODE || process.env.SENSEVOICE_API_KEY || "vidsnap-frames";
  const expected = await hmacHex(secret, `${videoId}:${idx}:${expMs}`);
  return expected === token.slice(dotIdx + 1);
}
