/**
 * 生成图溯源信息（素材管理 → 查看提示词 / 模型 / 比例 / 画质）。
 *
 * 素材表本身只存结果，生成参数在产出它的 `GenerationTask.params` 快照里。
 * 后台列表按素材反查任务后，用**同一份能力定义**重建提示词与参数标签：
 * 提示词是 `buildPrompt(params, refCount)` 的确定性结果，与提交时发给模型的
 * 文本同源；比例 / 画质的展示名也从能力定义的枚举选项取，避免后端与前端
 * 各维护一份中英文对照。
 */

import { getCapability } from '../capabilities/capability.registry';
import type { CapabilityParam } from '../capabilities/capability-plugin.type';

export interface AssetGenerationInfo {
  /** 产出该素材的任务 id，便于继续排查全链路 */
  taskId: string;
  /** 实际线路的展示名：渠道模型 displayName → 渠道模型 modelKey → 任务 modelKey */
  modelName: string;
  /** C 端模型分组键（任务快照） */
  modelKey: string | null;
  /** 实际发给模型的提示词 */
  prompt: string;
  /** 画面比例的展示名（如 `1:1` / `原比例`），能力无该参数时为 null */
  ratio: string | null;
  /** 输出画质的展示名（如 `1K (1024px)` / `1080P`），无该参数时为 null */
  quality: string | null;
}

/** 能力定义里表示「比例」的参数键，按优先级排列 */
const RATIO_KEYS = ['ratio', 'aspectRatio'];

/** 能力定义里表示「画质 / 输出规格」的参数键，按优先级排列 */
const QUALITY_KEYS = ['size', 'quality', 'resolution'];

/**
 * 从任务参数重建展示信息。
 *
 * `buildPrompt` 抛错（参数脏数据、能力定义已下线）时回落 `params.prompt`，
 * 绝不因为一条历史任务让整页列表失败。
 */
export function describeGeneration(
  capability: string,
  params: Record<string, any>,
  refCount: number,
): Pick<AssetGenerationInfo, 'prompt' | 'ratio' | 'quality'> {
  const def = getCapability(capability);

  let prompt = '';
  if (def?.buildPrompt) {
    try {
      prompt = String(def.buildPrompt(params, refCount) ?? '').trim();
    } catch {
      prompt = '';
    }
  }
  if (!prompt) prompt = String(params?.prompt ?? '').trim();

  const specs = def?.params ?? [];
  return {
    prompt,
    ratio: readParamLabel(params, specs, RATIO_KEYS),
    quality: readParamLabel(params, specs, QUALITY_KEYS),
  };
}

/**
 * 枚举参数 → 用户看到的标签。
 *
 * 认不出的值原样返回，与提示词构造器同一口径：新增选项却漏配 label 时，
 * 后台至少还能看到原始值，而不是被静默吞成「—」。
 */
function readParamLabel(
  params: Record<string, any>,
  specs: CapabilityParam[],
  keys: string[],
): string | null {
  for (const key of keys) {
    const raw = params?.[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const spec = specs.find((item) => item.key === key);
    const label = spec?.options?.find((option) => String(option.value) === String(raw))?.label;
    return label ?? String(raw);
  }
  return null;
}
