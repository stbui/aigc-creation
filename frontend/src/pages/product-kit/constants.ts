/**
 * 商品主图工作台页面的常量 —— 目录内文件的唯一常量入口。
 *
 * 约定: `product-kit/` 下的文件不从 `src/lib/constants` 直接取东西, 一律经由本文件 ——
 * 页面用到的上传上限、字段长度与变体清单集中可见, 调整只改一处。
 * 目录内新增共享常量时在这里补一行 re-export。
 */

/** 单张图片体积上限 (MB), 全站上传校验共用 */
export { MAX_IMAGE_MB } from '../../lib/constants';

// ───────────────── 上传与字段长度 (参考站实拍) ─────────────────

/** 本页能力 id（与后端 `capability.registry` 一致） */
export const PRODUCT_KIT_CAPABILITY = 'main_image';

/** 一次提交最多上传的商品图张数 */
export const MAX_IMAGES = 5;
/** 商品名称 / 品牌输入上限 */
export const MAX_NAME_LEN = 100;
/** 商品描述输入上限 */
export const MAX_DESC_LEN = 5000;

// ───────────────── 自定义配置 ─────────────────

/**
 * 自定义配置四类计数 → 主图变体。
 *
 * `key` 与后端 `definitions/param-options.ts` 的 `MAIN_IMAGE_VARIANTS`
 * 一一对应; `default` 即参考站初始计数 (白底/场景/卖点各 1、其他 0)。
 */
export const VARIANT_FIELDS = [
  { key: 'white_background', label: '白底图', default: 1 },
  { key: 'scene', label: '场景图', default: 1 },
  { key: 'selling_point', label: '卖点图', default: 1 },
  { key: 'other', label: '其他图', default: 0 },
] as const;

/** 变体键 → 中文标签 (结果网格的 caption 与占位卡共用) */
export const VARIANT_LABELS: Record<string, string> = {
  white_background: '白底图',
  scene: '场景图',
  selling_point: '卖点图',
  other: '其他图',
};
