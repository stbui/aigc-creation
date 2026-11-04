/**
 * 商品SKU图 —— 参考站 product-sku。按 SKU 清单批量出图。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { generateImageIntent } from '../model-mapping';
import { BG_COLOR_OPTIONS, QUALITY_OPTIONS, RATIOS } from './param-options';

/** 前端框选区域：归一化坐标 (0~1)，与模板图原始像素尺寸无关。 */
export interface SkuRegionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 每个变体区域的文字说明与参考图映射。 */
export interface SkuRegionVariant {
  regionId: string;
  instruction?: string;
  referenceAssetId?: string;
  referenceIndex?: number;
}

export const MAX_SKU_REGIONS = 3;

type SkuRegionType = 'rect' | 'ellipse' | 'brush';

interface ParsedSkuRegion extends SkuRegionBox {
  id: string;
  type: SkuRegionType;
}

const SKU_COLOR_OPTIONS = [
  { value: 'original', label: '保持模板原色' },
  ...BG_COLOR_OPTIONS.slice(1),
];

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
function parseRegionEntries(raw: unknown): ParsedSkuRegion[] {
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

  const out: ParsedSkuRegion[] = [];
  for (const [index, item] of value.slice(0, MAX_SKU_REGIONS).entries()) {
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
    const rawType = typeof box.type === 'string' ? box.type : '';
    const type: SkuRegionType =
      rawType === 'ellipse' || rawType === 'brush' ? rawType : 'rect';
    const id =
      (typeof box.regionId === 'string' && box.regionId.trim()) ||
      (typeof box.id === 'string' && box.id.trim()) ||
      `region-${index + 1}`;
    out.push({
      id,
      type,
      x: round4(left),
      y: round4(top),
      width: round4(w),
      height: round4(h),
    });
  }
  return out;
}

/** 对外保留纯坐标口径；提示词内部还需要区域 id 和形状，见 `parseRegionEntries`。 */
export function parseSkuRegions(raw: unknown): SkuRegionBox[] {
  return parseRegionEntries(raw).map(({ x, y, width, height }) => ({ x, y, width, height }));
}

/** 解析页面提交的变体说明；坏数据逐项丢弃，不阻断其余有效区域。 */
export function parseSkuVariants(raw: unknown): SkuRegionVariant[] {
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
  const out: SkuRegionVariant[] = [];
  for (const item of value.slice(0, MAX_SKU_REGIONS)) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const regionId = typeof entry.regionId === 'string' ? entry.regionId.trim() : '';
    if (!regionId) continue;
    const instruction = typeof entry.instruction === 'string' ? entry.instruction.trim().slice(0, 500) : '';
    const referenceAssetId = typeof entry.referenceAssetId === 'string' ? entry.referenceAssetId.trim() : '';
    const referenceIndex = Number(entry.referenceIndex);
    out.push({
      regionId,
      instruction: instruction || undefined,
      referenceAssetId: referenceAssetId || undefined,
      referenceIndex: Number.isFinite(referenceIndex) && referenceIndex > 0 ? Math.floor(referenceIndex) : undefined,
    });
  }
  return out;
}

/** `original` 表示不改模板原色；自定义色只有 skuColor=custom 时才生效。 */
export function resolveSkuColor(params: Record<string, any>): string {
  const key = String(params.skuColor ?? '').trim();
  if (!key || key === 'original') return '';
  return key === 'custom' ? String(params.customColor ?? '').trim() : key;
}

function percent(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function regionTypeLabel(type: SkuRegionType): string {
  if (type === 'ellipse') return '椭圆范围';
  if (type === 'brush') return '自由笔刷范围';
  return '矩形范围';
}

/** 输入图固定为「模板图 + 变体参考图」，参考图序号从输入图第 2 张开始。 */
function inputRoleText(refCount: number): string {
  if (refCount <= 1) {
    return '共上传 1 张模板图。它是唯一的版式、商品主体、背景、光影、镜头和画幅基准。';
  }
  const referenceRange = refCount === 2 ? '第 2 张' : `第 2-${refCount} 张`;
  return (
    `共上传 ${refCount} 张图：第 1 张是模板图，作为版式、商品主体、背景、光影、镜头和画幅基准；` +
    `${referenceRange}是变体参考图，只用于补充对应框选区域内的外观、颜色、材质、纹理、文字或背景信息；` +
    '不得把参考图整体套到模板上，也不得让参考图改变框外内容。'
  );
}

function colorText(color: string): string {
  if (!color) {
    return '未在区域说明或参考图中明确指定商品颜色时，保持模板中的原色。';
  }
  return (
    `本任务指定的 SKU 颜色为 ${color}；仅在区域说明要求改变颜色时应用于对应区域，` +
    '不得把商品结构、材质或纹理简化成纯色色块。'
  );
}

function regionInstructionText(
  region: ParsedSkuRegion,
  variant: SkuRegionVariant | undefined,
  refCount: number,
): string {
  const parts: string[] = [];
  if (variant?.instruction) {
    parts.push(`变化要求：${variant.instruction}`);
  } else if (variant?.referenceIndex || variant?.referenceAssetId) {
    parts.push('变化要求：仅按对应参考图补充该区域中明确的外观信息，未明确项保持模板原样');
  } else {
    parts.push('未提供明确变化要求，保持该区域原样');
  }
  if (variant?.referenceIndex && variant.referenceIndex + 1 <= refCount) {
    parts.push(`仅参考输入图第 ${variant.referenceIndex + 1} 张`);
  } else if (variant?.referenceAssetId) {
    parts.push('仅参考随任务提交的对应参考图');
  }
  return `${regionTypeLabel(region.type)}（左${percent(region.x)} 上${percent(region.y)} 宽${percent(region.width)} 高${percent(region.height)}）：${parts.join('；')}`;
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
    { key: 'skuColor', label: 'SKU 颜色', type: 'enum', default: 'original', options: SKU_COLOR_OPTIONS },
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
    {
      key: 'variants',
      label: '区域变体说明',
      type: 'text',
      hidden: true,
      maxLength: 6000,
      help: '每个区域对应的文字说明与参考图 index，最多 3 项',
    },
    { key: 'batchId', label: '批次 ID', type: 'text', hidden: true, maxLength: 128 },
    { key: 'batchIndex', label: '批次序号', type: 'number', hidden: true, min: 1, max: 100, step: 1 },
    { key: 'batchSize', label: '批次数量', type: 'number', hidden: true, min: 1, max: 100, step: 1 },
    { key: 'ratio', label: '画面比例', type: 'enum', default: '1:1', options: RATIOS },
    { key: 'size', label: '画质（输出边长）', type: 'enum', default: '1k', options: QUALITY_OPTIONS },
  ],
  buildPrompt: (p, refCount = 0) => {
    const regions = parseRegionEntries(p.regions);
    const variants = parseSkuVariants(p.variants);
    const skuName = String(p.skuName ?? '').trim();
    const color = resolveSkuColor(p);
    const target = regions.length
      ? `只编辑模板中框选的 ${regions.length} 个区域，区域及要求如下：\n${regions
          .map((region, index) => {
            const variant =
              variants.find((entry) => entry.regionId === region.id) ?? variants[index];
            return `区域${index + 1}｜${regionInstructionText(region, variant, refCount)}`;
          })
          .join('\n')}`
      : `旧版接口未提供框选坐标，只在模板的 ${p.region || '指定'} 区域替换 SKU 内容，其余画面保持不变`;
    const scopeLock = regions.length
      ? '框选范围是编辑上限；不得把改动扩散到区域外，也不得为了填满区域而重绘、扩张或移动商品。'
      : '指定位置是编辑上限；不得把改动扩散到该位置外，也不得为了填满区域而重绘、扩张或移动商品。';
    const ratio = String(p.ratio ?? '').trim();
    const quality = String(p.size ?? '').trim().toUpperCase();

    return [
      '【任务】',
      '基于上传的模板图生成一张电商 SKU 变体图。只替换用户框选区域内的指定信息，保留模板的完整版式。',
      skuName
        ? `当前 SKU 名称为「${skuName}」，它只用于标识本任务和理解变体含义，不默认作为画面文字。`
        : '当前 SKU 未提供名称；不得自行补写 SKU 名称、型号或规格文字。',
      '',
      '【输入分工｜硬约束】',
      inputRoleText(refCount),
      '',
      '【编辑范围｜硬约束】',
      target,
      scopeLock,
      '区域边界要自然衔接，不能出现硬边、接缝、残影、光晕或重复轮廓；不需要变化的像素保持原样。',
      '除用户明确要求外，不得整体调色、换背景、改镜头、改透视、改裁切、改画幅或重新排版。',
      '',
      '【商品一致性｜硬约束】',
      '保持模板中商品及同一画面内其他商品的轮廓、比例、结构、数量、配件、材质、纹理、图案、视角和遮挡关系。',
      '每个区域只改变用户明确指定的属性；未指定的颜色、材质、logo、包装、配件和文字必须保持原样。',
      '变体参考图只可补充对应区域的外观信息，不得把商品替换成不同品类或不同结构；不得拉伸、压扁或臆造不存在的细节。',
      colorText(color),
      '',
      '【文案与品牌｜硬约束】',
      '框外已有文字、logo、价格、参数和标签保持原样，不重写、不翻译、不美化、不遮挡。',
      '框内只有在区域说明明确给出文字时才允许改动文字，并按说明原样呈现；除非区域说明明确要求，否则不得根据 SKU 名称自动生成图中文字。',
      '不新增未提供的价格、优惠、销量、认证、功效、参数、售后承诺、品牌标识或行动号召；不复制参考图中的水印、二维码、平台界面或他人品牌元素。',
      '成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案。',
      '',
      '【画幅与质量】',
      ratio
        ? `目标画幅比例 ${ratio} 是硬约束；若模板比例不同，以目标比例优先，通过最小范围补边或裁切适配，不拉伸商品和背景。`
        : '保持模板原始画幅比例，不拉伸商品和背景。',
      quality ? `输出规格 ${quality}。` : '',
      '画面清晰、真实、干净，商品边缘自然，光影与模板一致，达到可直接用于电商 SKU 展示的质量。',
      '',
      '【输出】',
      '只输出当前 SKU 的一张完整成图，不输出拼图、九宫格、批量预览、前后对照图或多版本合集。',
    ]
      .filter(Boolean)
      .join('\n');
  },
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: generateImageIntent },
  inputs: 1,
  inWorkbench: false,
};
