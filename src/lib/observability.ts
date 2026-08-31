/**
 * 可观测性：token 用量成本核算（A4）
 */
import type { TokenUsage } from "./llm";

// DeepSeek deepseek-chat 定价（人民币元 / 百万 token），以官方最新为准
const PRICE_PROMPT_PER_M = 2; // 输入（缓存未命中）
const PRICE_COMPLETION_PER_M = 8; // 输出
const PRICE_CACHE_HIT_PER_M = 0.5; // 输入（缓存命中）

// 硅基流动 Qwen3-VL-32B-Instruct 定价（中国站人民币计价）
// 查询于 2026-08-31，来源 siliconflow.cn 模型中心，以官方最新为准
const VISION_PRICE_PROMPT_PER_M = 1;
const VISION_PRICE_COMPLETION_PER_M = 4;

/**
 * 计算单次 LLM 调用的成本（人民币元）
 * 缓存命中的输入 token 用更低单价（视觉模型无缓存价，按原价计）
 */
export function calcCost(usage: TokenUsage, provider: "deepseek" | "siliconflow-vl" = "deepseek"): number {
  if (provider === "siliconflow-vl") {
    return (
      (usage.promptTokens / 1_000_000) * VISION_PRICE_PROMPT_PER_M +
      (usage.completionTokens / 1_000_000) * VISION_PRICE_COMPLETION_PER_M
    );
  }

  const cacheHit = usage.cacheHitTokens || 0;
  const cacheMiss = Math.max(0, usage.promptTokens - cacheHit);
  const promptCost =
    (cacheMiss / 1_000_000) * PRICE_PROMPT_PER_M +
    (cacheHit / 1_000_000) * PRICE_CACHE_HIT_PER_M;
  const completionCost = (usage.completionTokens / 1_000_000) * PRICE_COMPLETION_PER_M;
  return promptCost + completionCost;
}
