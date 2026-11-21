/**
 * 积分商城页面的常量 —— 目录内文件的唯一常量入口。
 */

export const PACKAGES_PAGE_META = {
  title: '积分商城 · 货觉AI',
  description: '购买积分包与会员套餐，解锁全部 AI 创作能力。',
} as const;

/** 积分包按有效期分组：31 天短期包与永久包是两种消费方式，混在一排里没法比较 */
export const PACK_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '31 天有效' },
  { key: 'forever', label: '永久有效' },
] as const;

export type PackFilter = (typeof PACK_FILTERS)[number]['key'];

/** 各筛选项下的商品数（只展示真实存在的分类） */
export type PackCounts = Record<PackFilter, number>;

/* ── 区块与卡片共用样式 ────────────────────────────────────────────────
   会员档与积分包是同一张卡的两个变体，骨架类名只在常量里写一处，
   避免两个板块各抄一份后走样。 */

export const SECTION = 'mb-[30px]';

export const SECTION_HEAD =
  'mb-3.5 flex flex-wrap items-end justify-between gap-x-5 gap-y-1.5';

export const SECTION_COPY = 'flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1';

export const SECTION_TITLE = 'm-0 text-[17px] leading-6 font-bold text-foreground';

export const SECTION_DESC = 'm-0 text-[13px] leading-5 text-[color:var(--text-muted)]';

/** 卡片骨架；`plans` / `products` 各自补宽度与窄屏排布 */
export const CARD =
  'relative flex min-w-0 max-w-[280px] flex-[1_1_208px] flex-col gap-3 rounded-xl border border-border bg-card px-5 pt-[22px] pb-5 transition-[box-shadow,transform]';

export const CARD_HOVER =
  '[@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:shadow-[0_10px_26px_rgba(34,41,67,0.08)]';

export const CARD_CURRENT = 'border-brand shadow-[0_0_0_3px_rgba(85,70,216,0.08)]';

export const CARD_TOP = 'flex items-center justify-between gap-2';

export const CARD_NAME = 'text-[15px] leading-5 font-bold text-foreground [overflow-wrap:anywhere]';

export const CARD_BADGE =
  'shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap text-[color:var(--text-muted)]';

export const BADGE_FREE = 'bg-success-soft text-success-text';

export const BADGE_HOT = 'bg-warn-soft text-warn-text';

export const CARD_POINTS = 'flex items-baseline gap-[5px] text-brand';

export const CARD_POINTS_VALUE =
  'text-[28px] leading-[34px] font-bold tracking-[-0.5px] tabular-nums';

export const CARD_DESC = 'm-0 text-xs leading-[18px] text-[color:var(--text-muted)]';

export const CARD_PRICE =
  'mt-auto flex items-baseline gap-2 border-t border-dashed border-border pt-3.5';

export const CARD_PRICE_VALUE = 'text-xl leading-[26px] font-bold tabular-nums text-foreground';

export const CARD_PRICE_UNIT = 'text-xs text-[color:var(--text-muted)]';

export const CARD_PRICE_OLD = 'text-xs line-through text-[color:var(--text-desc)]';

/** 购买说明：用户口径 (有效期 / 扣费 / 退款)，两处共用 */
export const SHOP_DISCLOSURE =
  'mx-0 mt-2 mb-0 rounded-lg border border-dashed border-border bg-muted px-3.5 py-3 text-xs leading-5 text-[color:var(--text-muted)]';
