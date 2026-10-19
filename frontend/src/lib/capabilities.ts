import { API_ROOT, unwrapEnvelope } from './http';
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

let cache: CapabilitiesData | null = null;
let inflight: Promise<CapabilitiesData> | null = null;

export async function loadCapabilities(force = false): Promise<CapabilitiesData> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;

  inflight = (async () => {
    const res = await fetch(`${API_ROOT}/capabilities`);
    if (!res.ok) throw new Error(`能力清单加载失败（${res.status}）`);
    const data = unwrapEnvelope<CapabilitiesData>(await res.json());
    cache = data;
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
