import type { SkuRegion, SkuResultItem, ToolAsset, ToolSettings } from './components';

/**
 * 商品 SKU 图工作台页面的常量与类型 —— 目录内文件的唯一常量入口。
 *
 * 约定: `product-sku/` 下的文件不从 `src/lib/constants` 直接取东西, 一律经由本文件 ——
 * 页面上传上限、SKU 数量与批次类型集中可见, 调整只改一处。
 * 目录内新增共享常量时在这里补一行 re-export。
 */

/** 单张图片体积上限与支持格式, 全站上传校验共用 */
export {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
} from '../../lib/constants';

// ───────────────── SKU 数量与字段长度 ─────────────────

/** 模板图最多可框选的变体区域数 */
export const MAX_REGIONS = 3;
/** 一次提交最多生成的 SKU 数 */
export const MAX_SKUS = 10;
/** SKU 名称输入上限 */
export const MAX_SKU_NAME = 15;

// ───────────────── 表单与批次类型 ─────────────────

/** 某个 SKU 在某个变体区域下的填充内容 */
export interface SkuVariantContent {
  regionId: string;
  instruction: string;
  reference?: ToolAsset;
}

/** SKU 清单里的一行 */
export interface SkuItem {
  key: number;
  name: string;
  variants: Record<string, SkuVariantContent>;
}

/** 已发起、待轮询的任务 */
export interface StartedTask {
  taskId: string;
  label: string;
  planIndex: number;
}

/** 批次结果项 (在展示项上补提交时的排序) */
export interface SkuBatchResult extends SkuResultItem {
  /** 对齐提交时的 SKU 顺序；重试与状态回填都按它定位。 */
  planIndex: number;
}

/** 一次提交的完整快照, 重试时原样复用 */
export interface BatchPlan {
  batchId: string;
  template: ToolAsset;
  regions: SkuRegion[];
  items: SkuItem[];
  settings: ToolSettings;
}

/** 提交给后端的单区域参数 */
export interface VariantParam {
  regionId: string;
  instruction?: string;
  referenceAssetId?: string;
  referenceIndex?: number;
}

/** 素材库 / 手机上传的落点 */
export type LibraryTarget =
  | { kind: 'template' }
  | { kind: 'reference'; itemKey: number; regionId: string };

/** 未框选区域时展示的使用步骤；由 `ProductSkuStepsCard` 按顺序渲染。 */
export const SKU_STEPS = [
  { title: '上传模板图', description: '导入 SKU 图，作为批量生成的模板图' },
  { title: '框选要变化的区域', description: '框选可变内容区域，精准控制生成范围' },
  { title: '编辑SKU清单', description: '录入商品 SKU 信息，配置每个 SKU 的变化内容' },
  { title: '批量输出SKU图', description: '一键生成多款 SKU 图，高效完成批量出图' },
] as const;
