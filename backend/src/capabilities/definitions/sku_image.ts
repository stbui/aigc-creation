/**
 * 商品SKU图 —— 参考站 product-sku。按 SKU 清单批量出图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { BG_COLOR_OPTIONS, QUALITY_OPTIONS, RATIOS, ratioText, sizeText } from './param-options';

/** 前端框选区域：归一化坐标 (0~1)，与模板图原始像素尺寸无关。 */
export interface SkuRegionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_SKU_REGIONS = 3;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 解析 `regions` 参数。
 *
 * `sanitizeParams` 会把 text 参数收敛成字符串，所以正常链路收到的是 JSON 字符串；
 * 同时接受数组，供测试直接调用。最多保留 3 个区域，越界坐标收敛到画面内。
 */
export function parseSkuRegions(raw: unknown): SkuRegionBox[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const out: SkuRegionBox[] = [];
  for (const item of value.slice(0, MAX_SKU_REGIONS)) {
    if (!item || typeof item !== 'object') continue;
    const box = item as Record<string, unknown>;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width ?? box.w);
    const height = Number(box.height ?? box.h);
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    const left = clamp01(x);
    const top = clamp01(y);
    const right = clamp01(x + width);
    const bottom = clamp01(y + height);
    const w = right - left;
    const h = bottom - top;
    if (w < 0.005 || h < 0.005) continue;
    out.push({ x: round4(left), y: round4(top), width: round4(w), height: round4(h) });
  }
  return out;
}

/** 自定义色只有 skuColor=custom 时才生效；颜色值最终交给下游做 HEX 校验。 */
export function resolveSkuColor(params: Record<string, any>): string {
  const key = String(params.skuColor ?? '#FFFFFF');
  return key === 'custom' ? String(params.customColor ?? '') : key;
}

function percent(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

export const SkuImage: CapabilityPlugin = {
  id: 'sku_image',
  name: '商品SKU图',
  group: 'ecommerce_gen',
  summary: '按 SKU 批量出图。',
  sidebarHint: '批量生成同款不同规格图',
  mode: 'real',
  creditCost: 0, // 原页面标注「本次消耗0积分」
  help: '按模板图上框选的变体区域批量套版；框选坐标会随任务参数提交给模型',
  params: [
    {
      key: 'region',
      label: '变体区域',
      type: 'enum',
      default: 'center',
      options: [
        { value: 'center', label: '画面中心' },
        { value: 'top', label: '画面上方' },
        { value: 'bottom', label: '画面下方' },
        { value: 'left', label: '画面左侧' },
        { value: 'right', label: '画面右侧' },
      ],
      help: '旧版位置枚举；页面会优先使用 regions 框选坐标',
    },
    { key: 'skuName', label: 'SKU 名称', type: 'text', placeholder: '例如： CLASSIC BLACK / M' },
    { key: 'skuColor', label: 'SKU 颜色', type: 'enum', default: '#FFFFFF', options: BG_COLOR_OPTIONS.slice(1) },
    {
      key: 'customColor',
      label: '自定义颜色（HEX）',
      type: 'text',
      placeholder: '#RRGGBB',
      help: '仅当 SKU 颜色选择“自定义”时生效',
    },
    {
      key: 'regions',
      label: '框选变体区域',
      type: 'text',
      hidden: true,
      help: '页面框选产生的归一化坐标 JSON，最多 3 个区域',
    },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p) => {
    const regions = parseSkuRegions(p.regions);
    const color = resolveSkuColor(p);
    const target = regions.length
      ? `只替换模板中框选的 ${regions.length} 个区域（${regions
          .map(
            (r, i) =>
              `区域${i + 1}: 左${percent(r.x)} 上${percent(r.y)} 宽${percent(r.width)} 高${percent(r.height)}`,
          )
          .join('；')}），框外内容、商品主体和版式保持不变`
      : `在${p.region || '指定'}区域替换 SKU 内容`;
    return (
      `SKU 套图：沿用上传模板图的版式，${target}。` +
      `每个框选区域填入 SKU「${p.skuName || ''}」的信息（颜色 ${color || '保持原样'}）。` +
      `不要整体重绘模板，不要改动框外区域；批量输出版式一致的整组 SKU 图` +
      `${ratioText(p.ratio)}${sizeText(p.size)}`
    );
  },
  modality: 'image',
  inputs: 1,
  inWorkbench: false,
};
