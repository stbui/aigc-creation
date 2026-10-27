/**
 * 能力抽离等价性断言 (2026-10-20)。
 *
 * ## 为什么必须逐字段比对而不是靠类型检查
 *
 * 这次抽离把 791 行的能力定义拆到 15 个文件, 参数枚举有 200+ 项
 * (语言 10 / 融合场景 15 / 详情模块 16 / 平台 9 …)。
 * 这些值与参考站是 1:1 契约 —— **少一个下拉选项就是复刻偏差**。
 * 而 tsc 对"少了一项选项"完全无感 (类型仍是 ParamOption[]),
 * 只有把抽离前后的定义逐字段对比才能发现。
 *
 * 因此本文件固定了一组**抽离前的基线快照** (id / 参数键序 / 枚举取值 /
 * 积分价 / 模态), 与当前 definitions 逐项比对。
 * 后续任何人改动能力定义, 若动了这些契约字段, 本脚本会红。
 */

import { CAPABILITIES, defaultCreditCostOf, sanitizeParams } from '../src/capabilities/capability.registry';
import { CONFIG_DEFS } from '../src/providers/channel-config.defs';
import { buildPromptFor } from '../src/providers/gateway-prompt';

let pass = 0;
const fails: string[] = [];

function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass += 1;
  else fails.push(`${name}${detail !== undefined ? ` — 实际 ${JSON.stringify(detail)}` : ''}`);
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, Object.is(actual, expected), actual);
}

// ── 基线快照: 抽离前 capability.registry.ts 的契约字段 ───────────────
// 仅记录与参考站 1:1 绑定的部分 (顺序也有意义: 前端表单按 params 顺序渲染)
const BASELINE: Array<{
  id: string;
  creditCost: number;
  modality: string;
  paramKeys: string[];
  options: Record<string, string[]>; // paramKey → 选项 value 列表
}> = [
  {
    id: 'main_image', creditCost: 10, modality: 'image',
    paramKeys: ['productName', 'brand', 'platform', 'language', 'description', 'variant', 'ratio', 'size'],
    options: {
      platform: ['taobao', 'jd', 'douyin', 'pdd', 'xiaohongshu', 'amazon', 'tiktok-shop', 'shopify', 'temu'],
      language: ['zh-CN', 'en-US', 'ru-RU', 'es-ES', 'de-DE', 'ja-JP', 'ko-KR', 'pt-PT', 'id-ID', 'th-TH'],
      variant: ['white_background', 'scene', 'selling_point', 'other'],
      ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'detail_image', creditCost: 10, modality: 'image',
    paramKeys: ['productName', 'brand', 'platform', 'language', 'description', 'sections', 'sku', 'size'],
    options: {
      platform: ['taobao', 'jd', 'douyin', 'pdd', 'xiaohongshu', 'amazon', 'tiktok-shop', 'shopify', 'temu'],
      language: ['zh-CN', 'en-US', 'ru-RU', 'es-ES', 'de-DE', 'ja-JP', 'ko-KR', 'pt-PT', 'id-ID', 'th-TH'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'hot_remake', creditCost: 10, modality: 'image',
    paramKeys: ['productName', 'brand', 'platform', 'language', 'requirement', 'degree', 'ratio', 'size'],
    options: {
      platform: ['taobao', 'jd', 'douyin', 'pdd', 'xiaohongshu', 'amazon', 'tiktok-shop', 'shopify', 'temu'],
      language: ['zh-CN', 'en-US', 'ru-RU', 'es-ES', 'de-DE', 'ja-JP', 'ko-KR', 'pt-PT', 'id-ID', 'th-TH'],
      degree: ['reference_style', 'high_replica'],
      ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'creative_image', creditCost: 10, modality: 'image',
    paramKeys: ['prompt', 'ratio'],
    options: { ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'] },
  },
  {
    id: 'multi_fusion', creditCost: 40, modality: 'image',
    paramKeys: ['scene', 'variantCount', 'ratio', 'size', 'prompt'],
    options: {
      scene: [
        'print_pattern', 'embroidery', 'texture', 'sticker', 'hot_stamping', 'carving', 'painting',
        'table_display', 'wearing', 'scene_match', 'handheld', 'combo_set', 'food_plating',
        'storage_display', 'shelf_display',
      ],
      variantCount: ['4', '3', '2', '1'],
      ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'sku_image', creditCost: 0, modality: 'image',
    paramKeys: ['region', 'skuName', 'skuColor', 'customColor', 'regions', 'ratio', 'size'],
    options: {
      region: ['center', 'top', 'bottom', 'left', 'right'],
      // 页面支持框选多个 SKU 变体，并允许色板最后一档走自定义 HEX。
      skuColor: ['#FFFFFF', '#82CEF3', '#3988E9', '#FF0B22', '#A8001B', 'custom'],
      ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'local_redraw', creditCost: 5, modality: 'image',
    paramKeys: ['region', 'prompt', 'maskAssetId', 'modelGuideAssetId', 'annotations', 'strength', 'outputCount', 'ratio', 'imageRatio', 'size'],
    options: {
      region: ['center', 'top', 'bottom', 'left', 'right', 'full'],
      ratio: ['original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'expand', creditCost: 5, modality: 'image',
    // 2026-10-25: 追加参考站 placement* 字段（旧键与顺序保持不变）
    paramKeys: ['occupy', 'position', 'ratio', 'size', 'placementX', 'placementY', 'placementWidth', 'placementHeight', 'targetImageRatio'],
    options: {
      position: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'],
      ratio: ['original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'matting', creditCost: 0, modality: 'image',
    // 2026-10-25: 追加参考站 selectedColor/customAlpha（旧键与顺序保持不变）
    paramKeys: ['bgColor', 'customColor', 'ratio', 'selectedColor', 'customAlpha', 'resolution'],
    options: {
      bgColor: ['transparent', '#FFFFFF', '#82CEF3', '#3988E9', '#FF0B22', '#A8001B', 'custom'],
      selectedColor: ['transparent', 'white', 'light-blue', 'blue', 'red', 'dark-red', 'custom'],
      ratio: ['original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    },
  },
  {
    // 2026-10-21 去除水印从占位升级为镜像修补 + 羽化融合的真实算法
    id: 'remove_watermark', creditCost: 0, modality: 'image',
    paramKeys: ['mode', 'region', 'maskAssetId', 'detectionMode', 'outputFormat'],
    options: {
      mode: ['auto', 'region'],
      region: ['bottom_right', 'bottom_left', 'top_right', 'top_left', 'center'],
    },
  },
  {
    id: 'image_translate', creditCost: 5, modality: 'image',
    paramKeys: ['targetLang', 'protectSubject', 'size', 'targetLanguage'],
    options: {
      targetLang: ['zh-CN', 'en-US', 'ru-RU', 'es-ES', 'de-DE', 'ja-JP', 'ko-KR', 'pt-PT', 'id-ID', 'th-TH'],
      targetLanguage: ['zh-CN', 'en-US', 'ru-RU', 'es-ES', 'de-DE', 'ja-JP', 'ko-KR', 'pt-PT', 'id-ID', 'th-TH'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'enhance', creditCost: 5, modality: 'image',
    paramKeys: ['mode', 'note', 'ratio', 'size', 'templateCode', 'additionalRequirement', 'imageRatio'],
    options: {
      mode: ['comprehensive', 'texture', 'blemish', 'color', 'clarity', 'material'],
      ratio: ['original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'recolor', creditCost: 5, modality: 'image',
    paramKeys: ['color', 'customColor', 'ratio', 'size', 'targetColor'],
    options: {
      color: ['#FFFFFF', '#82CEF3', '#3988E9', '#FF0B22', '#A8001B', 'custom'],
      ratio: ['original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'rotate', creditCost: 5, modality: 'image',
    paramKeys: ['yaw', 'pitch', 'zoom', 'ratio', 'size', 'azimuthDeg', 'elevationDeg', 'zoomFactor', 'imageRatio'],
    options: {
      ratio: ['original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
  {
    id: 'free_create', creditCost: 10, modality: 'image',
    paramKeys: ['prompt', 'ratio', 'size'],
    options: {
      ratio: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
      size: ['1k', '2k', '4k'],
    },
  },
];

// ── 1. 能力数量与 id 集合 ────────────────────────────────────────────
/*
 * ⚠️ 基线是「抽离前的 15 项能力」, 用于**回归防护** (逐字段未变)。
 * 但**不锁死总数**: 后续新增能力时总数会增长 (如 2026-10-20 新增
 * image_to_video 视频能力, 15 → 16)。
 *
 * 故规则: 基线 15 项必须**全部存在且逐字一致** (防漂移/防改名),
 * 而多出来的能力必须**显式列在 ADDED_CAPABILITIES 里** —— 加了不说,
 * 断言会红, 强制补记。既不放过漂移, 也不阻止扩展。
 */
const ADDED_CAPABILITIES: string[] = ['image_to_video'];

eq('基线 15 项能力全部存在', BASELINE.filter((b) => CAPABILITIES.some((c) => c.id === b.id)).length, 15);
eq(
  '新增能力已在 ADDED_CAPABILITIES 显式登记',
  CAPABILITIES.filter((c) => !BASELINE.some((b) => b.id === c.id))
    .map((c) => c.id)
    .sort()
    .join(','),
  [...ADDED_CAPABILITIES].sort().join(','),
);

// ── 2. 逐项比对契约字段 ──────────────────────────────────────────────
for (const base of BASELINE) {
  const def = CAPABILITIES.find((c) => c.id === base.id);
  if (!def) {
    fails.push(`基线能力 ${base.id} 在注册表中不存在`);
    continue;
  }
  eq(`${base.id}.creditCost`, def.creditCost, base.creditCost);
  eq(`${base.id}.modality`, def.modality, base.modality);
  eq(
    `${base.id} 不再声明本地实现`,
    Object.prototype.hasOwnProperty.call(def, 'localImpl'),
    false,
  );
  eq(
    `${base.id} 参数键序`,
    def.params.map((p) => p.key).join(','),
    base.paramKeys.join(','),
  );
  for (const [key, values] of Object.entries(base.options)) {
    const param = def.params.find((p) => p.key === key);
    if (!param) {
      fails.push(`${base.id} 缺少参数 ${key}`);
      continue;
    }
    eq(
      `${base.id}.${key} 选项`,
      (param.options ?? []).map((o) => String(o.value)).join(','),
      values.join(','),
    );
  }
}

// ── 3. defaultCreditCostOf 与字段一致 ────────────────────────────────
for (const base of BASELINE) {
  eq(`defaultCreditCostOf(${base.id})`, defaultCreditCostOf(base.id), base.creditCost);
}

// ── 4. 路由配置项由能力派生 (不再是手写 id 列表) ────────────────────
for (const base of BASELINE) {
  const def = CONFIG_DEFS.find((d) => d.key === `gateway.route.${base.id}`);
  ok(`路由配置项存在: ${base.id}`, !!def);
  if (def) {
    eq(`路由项模态随能力: ${base.id}`, def.modality, base.modality);
    eq(`路由项 env 名: ${base.id}`, def.envName, `GATEWAY_ROUTE_${base.id.toUpperCase()}`);
    ok(`路由项未被标为 hidden: ${base.id}`, !def.hidden);
  }
}
eq(
  '路由配置项数量等于能力数量 (无手写遗漏/多余)',
  CONFIG_DEFS.filter((d) => d.key.startsWith('gateway.route.')).length,
  CAPABILITIES.length,
);

// ── 5. 提示词: 每项能力都能产出非裸 id 的提示词 ──────────────────────
for (const c of CAPABILITIES) {
  const p = buildPromptFor(c.id, { productName: '测试商品', prompt: '测试提示词' });
  ok(`${c.id} 提示词非空`, typeof p === 'string' && p.trim().length > 0);
  // 关键回归: 抽离前漏写提示词会回落成裸 id, 此处断言不得发生
  ok(`${c.id} 提示词不是裸能力 id`, p !== c.id, p);
}

// ── 6. 未知能力显式抛错而非静默回落 ─────────────────────────────────
let threw = false;
try {
  buildPromptFor('__不存在的能力__', {});
} catch {
  threw = true;
}
ok('未知能力构造提示词时抛错', threw);

// ── 7. sanitizeParams 行为不变 (抽离未影响参数收敛) ─────────────────
{
  const out = sanitizeParams('rotate', { yaw: 999, pitch: -999, zoom: 5 });
  eq('yaw 上限收敛', out.yaw, 90);
  eq('pitch 下限收敛', out.pitch, -30);
  eq('zoom 上限收敛', out.zoom, 1.2);
  const out2 = sanitizeParams('main_image', { platform: '__非法平台__' });
  eq('非法 enum 回落默认', out2.platform, 'taobao');
  const out3 = sanitizeParams('matting', { bgColor: 'transparent' });
  eq('合法 enum 透传', out3.bgColor, 'transparent');
}

// ── 8. 创意生图/自由创作的参考图均为选填 ────────────────────────────
for (const id of ['creative_image', 'free_create']) {
  const def = CAPABILITIES.find((c) => c.id === id);
  eq(`${id} 参考图选填`, def?.inputs, 0);
}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.error(`\n失败 ${fails.length} 项:`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('能力抽离等价性断言全部通过（与抽离前基线逐字段一致）');
