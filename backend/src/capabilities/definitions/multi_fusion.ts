/**
 * 多图融合 —— 参考站 multi-image-fusion。主体图 + 搭配图合成一张主视觉。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { FUSION_SCENARIOS, FUSION_VARIANT_COUNTS, QUALITY_OPTIONS, RATIOS, ratioText, sizeText } from './param-options';

/**
 * 多图融合画质倍率，与参考站 billing-config 对齐：
 * `1K=1x / 2K=2x / 4K=3x`。倍率乘的是后台配置的基础单价，而不是写死价格。
 */
export const MULTI_FUSION_RESOLUTION_MULTIPLIERS: Record<string, number> = {
  '1k': 1,
  '2k': 2,
  '4k': 3,
};

export function multiFusionCreditMultiplier(size: unknown): number {
  return MULTI_FUSION_RESOLUTION_MULTIPLIERS[String(size ?? '1k').toLowerCase()] ?? 1;
}

/**
 * 多图融合单次提交总价。
 *
 * 能力基础价对应默认的 4 张变体，参考站按「每张单价 × 张数 × 画质倍率」计费。
 * 张数在这里再次收敛到 1-4，避免绕过参数校验的调用方按离谱数量扣费。
 */
export function multiFusionCreditCost(
  baseCost: number,
  variantCount: unknown,
  size: unknown,
): number {
  const count = Math.max(1, Math.min(4, Math.floor(Number(variantCount) || 1)));
  return Math.round(
    (baseCost * count * multiFusionCreditMultiplier(size)) / 4,
  );
}

/** 画质档位对应的输出长边；比例换算与图像通道的 64px 对齐口径一致。 */
export function multiFusionOutputDimensions(
  ratio: unknown,
  size: unknown,
): { width: number; height: number } | null {
  const [rw, rh] = String(ratio ?? '1:1')
    .split(':')
    .map((value) => Number(value) || 1);
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return null;
  const longEdge = ['4k', '2k'].includes(String(size).toLowerCase())
    ? String(size).toLowerCase() === '4k'
      ? 4096
      : 2048
    : 1024;
  const width = rw >= rh ? longEdge : Math.round((longEdge * rw) / rh);
  const height = rw >= rh ? Math.round((longEdge * rh) / rw) : longEdge;
  return {
    width: Math.max(64, Math.round(width / 64) * 64),
    height: Math.max(64, Math.round(height / 64) * 64),
  };
}

export const MultiFusion: CapabilityPlugin = {
  id: 'multi_fusion',
  name: '多图融合',
  group: 'ecommerce_gen',
  summary: '多张素材合成一张主视觉。',
  sidebarHint: '多图合成，保留主体一致性',
  mode: 'real',
  creditCost: 40, // 原页面标注「本次消耗40积分」
  help: '由图像模型完成场景语义融合，需要可用的图像通道',
  params: [
    { key: 'scene', label: '融合场景', type: 'enum', default: 'print_pattern', options: FUSION_SCENARIOS },
    { key: 'variantCount', label: '变体张数', type: 'enum', default: '4', options: FUSION_VARIANT_COUNTS },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
    {
      key: 'prompt',
      label: '画面描述（选填）',
      type: 'text',
      maxLength: 4000,
      placeholder: '点击「AI分析」按主体图生成，或手写画面要求',
    },
    // 服务端在多变体生成时为每次模型调用注入；页面不直接提交这两个字段。
    { key: 'variantIndex', label: '变体序号', type: 'number', hidden: true, min: 1, max: 4, step: 1 },
    { key: 'variantTotal', label: '变体总数', type: 'number', hidden: true, min: 1, max: 4, step: 1 },
  ],
  buildPrompt: (p) => {
    // 2026-10-22: 新增画面描述, 由「AI分析」(promptToolsApi.imageToPrompt) 生成或用户手写。
    // 为空时保持原提示词, 不塞占位文案 —— 空描述不等于没有要求。
    const desc = String(p.prompt ?? '').trim();
    const descPart = desc ? `，画面描述：${desc}` : '';
    const sceneLabel =
      FUSION_SCENARIOS.find((option) => option.value === String(p.scene ?? ''))?.label ?? '自然融合';
    const variantTotal = Math.max(1, Math.min(4, Number(p.variantTotal) || 1));
    const variantIndex = Math.max(1, Math.min(variantTotal, Number(p.variantIndex) || 1));
    const variantPart =
      variantTotal > 1
        ? `。这是第 ${variantIndex} 个候选方案（共 ${variantTotal} 个），` +
          '构图、主体角度、光影或场景细节必须与其他候选形成真实差异，但主体造型、材质和核心识别特征保持一致'
        : '';
    return (
      `多图融合，场景：${sceneLabel}。` +
      '第一张输入图是主体图，必须作为画面主视觉，完整保留其商品/对象造型、颜色、材质、结构和文字标识，不得被搭配图中的物体替换；' +
      '其余输入图是搭配图，只用于补充场景、人物、道具或氛围。保持光影与透视合理' +
      `${descPart}` +
      `${ratioText(p.ratio)}${sizeText(p.size)}${variantPart}`
    );
  },
  modality: 'image',
  inputs: 2,
  inWorkbench: false,
};
