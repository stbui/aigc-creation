import { API_ROOT, unwrapEnvelope } from './http';
import { runtimeOf } from './constants';
import type { Capability, CapabilityDef, CapabilityGroup } from '../types/api';

/**
 * 能力清单数据层。
 *
 * 清单只从后端取一次 (GET /api/v1/capabilities), 全站共享:
 * 侧栏、工作台卡片、工具页表单、统计页分布都基于同一份数据。
 * 后端 capability.registry 是唯一事实源 —— 此前"清单写多处"导致的契约漂移正是根因。
 */

export interface CapabilitiesData {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  workbenchIds: string[];
}

/**
 * 客户端缓存有效期。
 *
 * 后端 availability 缓存是 3s（后台下线/调价后立即 invalidate），前端若永久缓存，
 * 运营改完配置、用户已打开的页面却一直显示旧状态与旧价格，只能整页刷新。
 * 这里给 5s 的短 TTL：正常浏览几乎不增加请求，后台变更又能很快反映到 C 端。
 */
const CACHE_TTL_MS = 5_000;

let cache: CapabilitiesData | null = null;
let cachedAt = 0;
let inflight: Promise<CapabilitiesData> | null = null;

export async function loadCapabilities(force = false): Promise<CapabilitiesData> {
  if (cache && !force && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const res = await fetch(`${API_ROOT}/capabilities`);
    if (!res.ok) throw new Error(`能力清单加载失败（${res.status}）`);
    const data = unwrapEnvelope<CapabilitiesData>(await res.json());
    cache = data;
    cachedAt = Date.now();
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 同步读取 (仅在清单已加载后使用) */
export function capabilitiesSync(): CapabilityDef[] {
  return cache?.items ?? [];
}

export function groupsSync(): CapabilityGroup[] {
  return cache?.groups ?? [];
}

export function capabilityById(id: string | undefined | null): CapabilityDef | undefined {
  if (!id) return undefined;
  return cache?.items.find((c) => c.id === id);
}

export function capabilityName(id: string | undefined | null): string {
  if (!id) return '未知能力';
  return cache?.items.find((c) => c.id === id)?.name ?? id;
}

/**
 * 是否应出现在 C 端导航 / 工作台 / 工具入口里。
 *
 * 「规划中」与运营下线的能力都不再给入口：前者本来就不能提交，后者点进去
 * 只会看到一张说明页。继续渲染一个不可用入口会让用户以为页面坏了；PRD
 * F-12 也明确要求下架能力从侧栏、顶导、工作台卡片等处隐藏。
 *
 * 注意与 `unavailable` 的区别：它表示「代码已实现，但此刻没有可用通道」。
 * 这种能力仍保留入口，页面内会说明原因并禁用提交 —— 直接隐藏会让用户
 * 误以为产品没有这项能力。
 */
export function isCapabilityVisible(
  def: Pick<CapabilityDef, 'mode' | 'runtime' | 'localFallback' | 'localImpl' | 'modality'>,
): boolean {
  return def.mode !== 'planned' && runtimeOf(def).effective !== 'disabled';
}

/**
 * 能力入口路径。商品主图 (main_image) / 商品详情图 (detail_image) / 爆款复刻 (hot_remake) /
 * 自由创作 (free_create) 分别走 1:1 复刻参考站的 product-kit / product-detail / viral-clone /
 * free-creation 工作台页; 多图融合/商品SKU图/修图系 8 项同样按参考站 URL 复刻独立页面;
 * 其余能力走通用工具页。
 * 侧栏 / 顶导 / 工作台卡片共用同一映射, 避免多处漂移。
 */
export function toolPath(id: string): string {
  if (id === 'main_image') return '/product-kit';
  if (id === 'detail_image') return '/product-detail';
  if (id === 'hot_remake') return '/viral-clone';
  if (id === 'free_create') return '/free-creation';
  // 参考站「创意生图」与「自由创作」共用同一页 (实拍: 侧栏点击创意生图 → /free-creation)
  if (id === 'creative_image') return '/free-creation';
  if (id === 'multi_fusion') return '/multi-image-fusion';
  if (id === 'sku_image') return '/product-sku';
  if (id === 'local_redraw') return '/local-redraw';
  if (id === 'matting') return '/background-remove';
  if (id === 'remove_watermark') return '/watermark-remove';
  if (id === 'enhance') return '/product-retouch';
  if (id === 'image_translate') return '/image-translate';
  if (id === 'expand') return '/image-expand';
  if (id === 'recolor') return '/product-recolor';
  if (id === 'rotate') return '/rotate-angle';
  return `/tools/${id}`;
}

export type { Capability, CapabilityDef, CapabilityGroup };
