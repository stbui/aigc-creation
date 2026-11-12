/**
 * 网站地图页面的纯函数 —— 目录内文件的唯一本页工具来源。
 */

import type { CapabilityDef } from '../../types/api';
import { isCapabilityVisible } from '../../lib/capabilities';
import type { SitemapSection } from './constants';

/**
 * 按能力运行时可见性过滤条目。
 *
 * 清单未到达时保留全部分组（公开页不应因一次清单抖动整块消失）；
 * 到达后隐藏运营下线能力对应的条目，并丢掉因此变空的分组。
 */
export function filterVisibleSections(
  sections: SitemapSection[],
  items: CapabilityDef[] | undefined,
): SitemapSection[] {
  if (!items) return sections;
  const visible = new Set(items.filter(isCapabilityVisible).map((item) => item.id));
  return sections
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => !link.capability || visible.has(link.capability)),
    }))
    .filter((section) => section.links.length > 0);
}
