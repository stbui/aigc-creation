import type { SkuBatchGroup } from '../../lib/skuBatches';
import type { SkuRegion, SkuResultItem, ToolAsset } from './components';
import type { GalleryItem } from './hooks';
import {
  MAX_REGIONS,
  type SkuItem,
  type SkuVariantContent,
  type VariantParam,
} from './constants';

/**
 * 商品 SKU 图工作台页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `product-sku/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 页面用到的图片校验、批次归组、轮询与错误文案集中可见, 换实现只改一处。
 * 目录内新增外部工具引用时在这里补一行 re-export。
 */

/** 上传前的图片格式校验 */
export { isSupportedImageFile, taskErrorText } from '../../lib/constants';
/** 任务轮询到终态 */
export { pollToResult } from '../../lib/poll';
/** 浏览器内批量打包下载 */
export { downloadUrlsAsZip } from '../../lib/zip';
/** 历史提交归组与定位 */
export { groupContainsTask, groupSkuHistory, type SkuBatchGroup } from '../../lib/skuBatches';

/* ------------------------------------------------------------------------- */
/* SKU 清单                                                                  */
/* ------------------------------------------------------------------------- */

/** SKU 行的自增 key (只在本次会话内唯一) */
let skuSeq = 0;

/** 新建一行 SKU; 已框选的区域先落成空变体 */
export function createSkuItem(regions: SkuRegion[], name = 'SKU 1'): SkuItem {
  return {
    key: ++skuSeq,
    name,
    variants: Object.fromEntries(
      regions.map((region) => [region.id, { regionId: region.id, instruction: '' }]),
    ),
  };
}

/** 复制一行 SKU (保留变体区域, 不复制说明与参考图) */
export function cloneSkuItem(source: SkuItem, name: string): SkuItem {
  return {
    key: ++skuSeq,
    name,
    variants: Object.fromEntries(
      Object.keys(source.variants).map((regionId) => [
        regionId,
        { regionId, instruction: '', reference: undefined } satisfies SkuVariantContent,
      ]),
    ),
  };
}

/** 区域变化后重排每行的变体, 保留仍然存在的区域内容 */
export function syncVariants(items: SkuItem[], regions: SkuRegion[]): SkuItem[] {
  return items.map((item) => {
    const variants: Record<string, SkuVariantContent> = {};
    for (const region of regions) {
      variants[region.id] = item.variants[region.id] ?? { regionId: region.id, instruction: '' };
    }
    return { ...item, variants };
  });
}

/** 恢复历史时生成新的行 key */
export function nextSkuKey(): number {
  return ++skuSeq;
}

/**
 * 局部更新某个 SKU 在某个区域下的内容。
 *
 * 名称输入与变体说明 / 参考图回填共用这一条更新路径，避免各写一份 map；
 * 区域缺失时按空内容补齐，保证恢复历史与新建行读到同一形状。
 */
export function patchSkuVariant(
  items: SkuItem[],
  itemKey: number,
  regionId: string,
  patch: Partial<Omit<SkuVariantContent, 'regionId'>>,
): SkuItem[] {
  return items.map((item) => {
    if (item.key !== itemKey) return item;
    const previous = item.variants[regionId] ?? { regionId, instruction: '' };
    return {
      ...item,
      variants: { ...item.variants, [regionId]: { ...previous, ...patch } },
    };
  });
}

/* ------------------------------------------------------------------------- */
/* 任务参数反解 (历史提交恢复)                                                */
/* ------------------------------------------------------------------------- */

/** 任务参数里的区域 JSON → 区域数组; 非法值直接丢弃 */
export function normalizeRegions(raw: unknown): SkuRegion[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: SkuRegion[] = [];
  for (const [index, entry] of value.slice(0, MAX_REGIONS).entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const box = entry as Record<string, unknown>;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const type = box.type === 'ellipse' || box.type === 'brush' ? box.type : 'rect';
    out.push({
      id:
        typeof box.regionId === 'string'
          ? box.regionId
          : typeof box.id === 'string'
            ? box.id
            : `restored-region-${index + 1}`,
      type,
      x,
      y,
      width,
      height,
    });
  }
  return out;
}

/** 任务参数里的变体 JSON → 参数数组; 非法值直接丢弃 */
export function normalizeVariants(raw: unknown): VariantParam[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const regionId = typeof item.regionId === 'string' ? item.regionId : '';
    if (!regionId) return [];
    return [
      {
        regionId,
        instruction: typeof item.instruction === 'string' ? item.instruction : undefined,
        referenceAssetId:
          typeof item.referenceAssetId === 'string' ? item.referenceAssetId : undefined,
        referenceIndex:
          typeof item.referenceIndex === 'number' ? item.referenceIndex : undefined,
      },
    ];
  });
}

/** 历史恢复所需的页面草稿；写回 state 由 `page.tsx` 负责。 */
export interface RestoredSkuDraft {
  template: ToolAsset;
  regions: SkuRegion[];
  items: SkuItem[];
  defaultRatio: string;
  defaultResolution: string;
}

/** 恢复历史只需要任务上的参数与输入素材，不依赖接口层类型。 */
export interface RestorableTask {
  params?: Record<string, unknown>;
  inputAssetIds?: string[];
}

/**
 * 历史任务 + 输入素材 → 可继续编辑的 SKU 草稿。
 *
 * `assetOf` 由页面用已取到的素材构造（含显示地址），这里只按 id 取；
 * 模板图或区域缺失时抛错，由页面提示「原模板或参考图已不可用」。
 */
export function restoreSkuDraft(
  tasks: RestorableTask[],
  assetOf: (id: string) => ToolAsset | undefined,
  group: SkuBatchGroup,
): RestoredSkuDraft {
  const primaryTask =
    tasks.find((task) => normalizeRegions(task.params?.regions).length > 0) ?? tasks[0];
  const template = primaryTask?.inputAssetIds?.[0]
    ? assetOf(primaryTask.inputAssetIds[0])
    : undefined;
  if (!template) throw new Error('原模板图已不可用');

  const regions = normalizeRegions(primaryTask?.params?.regions);
  if (regions.length === 0) throw new Error('这条历史记录没有可恢复的区域');

  const items = tasks.map((task, index) => {
    const variantParams = normalizeVariants(task.params?.variants);
    const name =
      typeof task.params?.skuName === 'string'
        ? task.params.skuName
        : group.items[index]?.caption || `SKU ${index + 1}`;
    return {
      key: nextSkuKey(),
      name,
      variants: Object.fromEntries(
        regions.map((region, regionIndex) => {
          const variant =
            variantParams.find((entry) => entry.regionId === region.id) ??
            variantParams[regionIndex];
          return [
            region.id,
            {
              regionId: region.id,
              instruction: variant?.instruction ?? '',
              reference: variant?.referenceAssetId
                ? assetOf(variant.referenceAssetId)
                : undefined,
            } satisfies SkuVariantContent,
          ];
        }),
      ),
    } satisfies SkuItem;
  });

  return {
    template,
    regions,
    items,
    defaultRatio: typeof primaryTask?.params?.ratio === 'string' ? primaryTask.params.ratio : '1:1',
    defaultResolution: typeof primaryTask?.params?.size === 'string' ? primaryTask.params.size : '1k',
  };
}

/* ------------------------------------------------------------------------- */
/* 结果 → 展示口径                                                           */
/* ------------------------------------------------------------------------- */

/** 历史任务 → 结果面板条目 */
export function resultFromGallery(item: GalleryItem): SkuResultItem {
  return {
    id: item.id,
    label: item.caption || 'SKU 图',
    status: item.status ?? 'succeeded',
    url: item.url || undefined,
    width: item.width,
    height: item.height,
  };
}

/** 把 SKU 名称变成安全文件名 */
export function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'SKU';
}

/** 批次打包文件名；按自然日命名，同一天多次下载不会互相覆盖目录结构。 */
export function skuZipFilename(): string {
  return `sku-batch-${new Date().toISOString().slice(0, 10)}.zip`;
}

/** 单张结果直接下载 */
export function downloadDirect(item: SkuResultItem) {
  if (!item.url) return;
  const anchor = document.createElement('a');
  anchor.href = item.url;
  anchor.download = `${safeFilename(item.label)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
