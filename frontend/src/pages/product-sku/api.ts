/**
 * 商品 SKU 图工作台页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 接线: 模板图 + 变体区域 + SKU 清单 → 每个 SKU 一条 `sku_image` 任务;
 * 整批共用同一个模型线路, 保证版式一致。
 *
 * 约定: `product-sku/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

import { assetSrc, toAbsoluteUrl } from '../../lib/api';
import type { ToolAsset } from './components';

/** 素材上传 / 地址换算 / 生成任务 / 幂等键 */
export {
  assetsApi,
  assetSrc,
  assetThumbUrl,
  generateApi,
  newIdempotencyKey,
  toAbsoluteUrl,
} from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';

/** 素材 / 手机上传的入参：两种来源的地址字段不同，取到哪个用哪个。 */
interface ToolAssetSource {
  id: string;
  sourceUrl?: string | null;
  signedUrl?: string | null;
  url?: string | null;
}

/**
 * 后端素材 → 工作台展示口径。
 *
 * 地址优先级与 `assetSrc()` 一致：签名地址 > 干净地址 > 手机上传的 `url`；
 * 仍为空时保留空串，由调用方决定是否拒绝这次选择。
 */
export function toToolAsset(source: ToolAssetSource, name: string): ToolAsset {
  return {
    id: source.id,
    url: assetSrc(source) ?? toAbsoluteUrl(source.url) ?? '',
    name,
  };
}

/** 从素材地址取文件名，取不到时用 `fallback`；忽略查询串。 */
export function fileNameFromUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  return url.split('?')[0].split('/').pop() || fallback;
}
