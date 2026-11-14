import type { Asset } from '../types/api';

/**
 * 素材库选择器的筛选项与筛选计算（纯函数，不依赖 React）。
 *
 * 2026-11-15 从 `AssetLibraryModal` 抽出：该文件此前把「筛选维度定义 + 日期区间
 * 计算 + 用途聚合 + 过滤规则 + 三块布局 JSX + 卡片」放在一起，改一条筛选规则
 * 要在 600 行里翻。这里只留数据口径，弹窗只负责状态与渲染。
 *
 * 筛选在**前端**完成：列表随弹窗打开一次性拉取（120 条），量级下开销可忽略，
 * 且省掉每次切换筛选项都打一次接口。
 */

/** 侧栏维度 —— 本项目素材库真实存在的分类 */
export type PickerKind = 'all' | 'original' | 'generated';

/** 日期筛选档位 —— 参考站工具栏的「全部 / 今天 / 昨天 / 近 7 天」 */
export type DateFilter = 'all' | 'today' | 'yesterday' | 'week';

/** 用途筛选中代表「没有关联能力」的哨兵值 */
export const NO_CAPABILITY = '__none';

export const KIND_LABELS: Array<{ id: PickerKind; label: string }> = [
  { id: 'all', label: '全部图片' },
  { id: 'original', label: '原始图片' },
  { id: 'generated', label: '生成图片' },
];

export const DATE_LABELS: Array<{ id: DateFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'week', label: '近 7 天' },
];

/** 侧栏「用途分类」的一项：当前素材中真实存在的用途与条数。 */
export interface CapabilityOption {
  id: string;
  label: string;
  count: number;
  /** 排序位：跟随后端能力清单，清单里没有的历史 id 排在最后。 */
  order: number;
}

/** 日期档位 → 起始时刻 */
function startOfDay(filter: Exclude<DateFilter, 'all'>): number {
  const d = new Date();
  if (filter === 'yesterday') d.setDate(d.getDate() - 1);
  if (filter === 'week') d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 日期档位 → 结束时刻 */
function endOfDay(filter: Exclude<DateFilter, 'all'>): number {
  const d = new Date();
  if (filter === 'yesterday') d.setDate(d.getDate() - 1);
  if (filter === 'week') d.setDate(d.getDate() - 6);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** capability id → 展示名。能力清单不可用时退回 id, 不隐藏真实分类。 */
export function buildCapabilityNames(capabilityItems: Array<{ id: string; name: string }> | undefined) {
  const names = new Map<string, string>();
  for (const capability of capabilityItems ?? []) {
    names.set(capability.id, capability.name);
  }
  return names;
}

/** 用途展示名; 卡片与搜索共用, 保证文案一致。 */
export function capabilityLabelOf(names: Map<string, string>) {
  return (id: string | null | undefined) => (id ? (names.get(id) ?? id) : '未关联用途');
}

/**
 * 只聚合当前素材中真实存在的用途, 避免侧栏出现永远筛不出内容的空分类。
 * 顺序优先跟随后端能力清单; 清单里没有的历史 id 按名称排在后面。
 */
export function buildCapabilityOptions(
  items: Asset[],
  capabilityItems: Array<{ id: string; name: string }> | undefined,
  names: Map<string, string>,
): CapabilityOption[] {
  const counts = new Map<string, number>();
  let uncategorized = 0;
  for (const item of items) {
    if (!item.capability) {
      uncategorized += 1;
      continue;
    }
    counts.set(item.capability, (counts.get(item.capability) ?? 0) + 1);
  }

  const order = new Map((capabilityItems ?? []).map((capability, index) => [capability.id, index]));
  const options: CapabilityOption[] = [...counts.entries()].map(([id, count]) => ({
    id,
    label: names.get(id) ?? id,
    count,
    order: order.get(id) ?? Number.MAX_SAFE_INTEGER,
  }));
  options.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'));
  if (uncategorized > 0) {
    options.push({
      id: NO_CAPABILITY,
      label: '未关联用途',
      count: uncategorized,
      order: Number.MAX_SAFE_INTEGER,
    });
  }
  return options;
}

interface FilterInput {
  kind: PickerKind;
  capabilityFilter: string;
  dateFilter: DateFilter;
  keyword: string;
}

/** 按维度 / 用途 / 日期 / 关键词过滤素材。 */
export function filterAssets(
  items: Asset[],
  { kind, capabilityFilter, dateFilter, keyword }: FilterInput,
  capabilityLabel: (id: string | null | undefined) => string,
): Asset[] {
  let list = items;
  if (kind !== 'all') list = list.filter((a) => a.kind === kind);
  if (capabilityFilter === NO_CAPABILITY) {
    list = list.filter((a) => !a.capability);
  } else if (capabilityFilter !== 'all') {
    list = list.filter((a) => a.capability === capabilityFilter);
  }
  if (dateFilter !== 'all') {
    const from = startOfDay(dateFilter);
    const to = endOfDay(dateFilter);
    list = list.filter((a) => {
      const t = new Date(a.createdAt ?? 0).getTime();
      return t >= from && t <= to;
    });
  }
  const kw = keyword.trim().toLowerCase();
  if (kw) {
    // placeholder 写的是“素材名称”，但 Asset 没有独立名称字段；
    // 用文件名/来源标题/能力名/来源站点一起匹配，避免用户按名字搜不到。
    list = list.filter((a) =>
      [a.sourceUrl, a.sourceTitle ?? '', a.sourceSite ?? '', a.capability ?? '', capabilityLabel(a.capability)]
        .join(' ')
        .toLowerCase()
        .includes(kw),
    );
  }
  return list;
}
