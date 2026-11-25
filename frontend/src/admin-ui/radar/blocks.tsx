/**
 * 中性风格（freebie-radar 设计语言）后台构建块。
 *
 * 后台内容层构建块：页头 / 面板 / 统计卡 / 分段筛选，全部走 `radar-*` 令牌与
 * 「零阴影 + 1px 细线 + 颜色编码语义」语言。列表态见 `./states`，待办队列见
 * `./workQueue`，骨架见 `./skeleton`。
 *
 * 用途：后台业务页统一从 `./index` 取件；本层是后台唯一的组件实现层，
 * 不再是「覆盖 primitives」的皮肤层（重复实现已于 2026-11-20 删除）。
 *
 * 约定：本文件只消费 radar 令牌，**不 import 任何 shadcn / 品牌紫令牌**；
 * 令牌由 `styles/radar-admin.css` 在被消费页面 chunk 内载入。
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/* ────────────────────────── 全幅画布容器 ────────────────────────── */

/**
 * 中性风格页面容器：灰底与 26/18 内边距统一由外壳 `.adm-content` 提供
 * （`bg-page` + `px-[26px] pt-[18px] pb-14`，阶段 1 起 page-bg 与 radar-canvas
 * 同为 #f6f7f9），内部白底细线面板浮在上面 ——「灰底 + 白卡」层次不变。
 *
 * 2026-11-25：移除此处的负边距抵消与重复 padding。旧实现用负外边距把灰底铺到
 * 内容区边缘再自己加回内边距，是「外壳 padding + 页面负边距」双重契约，
 * 改一处必须同步另一处。现灰底由外壳同色提供，页面只保留中性作用域标记与
 * 最小高度，几何契约单一落在 AdminBoardLayout。
 */
export function RadarPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('radar-scope min-h-full', className)}>
      {children}
    </div>
  );
}

/* ────────────────────────── 页头 ────────────────────────── */

/** 页面标题区：标题 + 副标题在左，操作在右。副标题不截断，照常渲染。 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** 兼容 shadcn 同签名的占位项；radar 固定副标题在下，不展开内联。 */
  inlineDescription?: boolean;
}) {
  return (
    <header
      data-testid="admin-page-header"
      className={cn('flex items-start justify-between gap-4 pb-4', className)}
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-radar-ink-950">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] leading-5 text-radar-ink-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ────────────────────────── 面板 ────────────────────────── */

/**
 * 内容面板：白底 + 1px 细线 + 8px 圆角（零阴影）。可选标题行（h2）+ 口径说明 +
 * 右侧 extra（如分段筛选）；标题区下方用单根细线与内容分隔（不描边堆叠）。
 */
export function Panel({
  title,
  note,
  extra,
  narrow = false,
  className,
  children,
}: {
  title?: ReactNode;
  note?: ReactNode;
  extra?: ReactNode;
  /** 限制内容宽度到 760px（表单型页面阅读宽度）。 */
  narrow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid="admin-panel"
      style={narrow ? { maxWidth: 760 } : undefined}
      className={cn('panel mb-4 overflow-hidden', className)}
    >
      {(title || note || extra) && (
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            {title && (
              <h2
                className={cn(
                  'text-[13px] font-semibold text-radar-ink-900',
                  !note && 'leading-5',
                )}
              >
                {title}
              </h2>
            )}
            {note && (
              <p
                className={cn(
                  'text-[12.5px] leading-5 text-radar-ink-400',
                  title && 'mt-0.5',
                )}
              >
                {note}
              </p>
            )}
          </div>
          {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
        </div>
      )}
      <div className={cn('p-5', (title || note || extra) && 'border-t border-radar-ink-100')}>
        {children}
      </div>
    </section>
  );
}

/* ────────────────────────── 统计卡 ────────────────────────── */

/** 单张统计卡：标签 + 数字（`tabular-nums` 等宽对齐）+ 提示；tone 染色。 */
export function StatCard({
  label,
  value,
  hint,
  tone,
  inline = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'danger' | 'warn';
  /** 指标卡内容较少时，标签和值并排，避免多占一行。 */
  inline?: boolean;
  className?: string;
}) {
  const toneSurface =
    tone === 'danger'
      ? 'bg-radar-alert-subtle border-radar-alert-border'
      : tone === 'warn'
        ? 'bg-radar-code-subtle border-radar-code-border'
        : 'bg-radar-surface border-radar-ink-200';
  const valueColor =
    tone === 'danger'
      ? 'text-radar-alert'
      : tone === 'warn'
        ? 'text-radar-code'
        : 'text-radar-ink-950';
  return (
    <div
      data-testid="admin-stat-card"
      className={cn(
        'justify-center rounded-[8px] border px-4 py-3',
        inline ? 'min-h-0' : 'min-h-[92px]',
        toneSurface,
        className,
      )}
    >
      {inline ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="shrink-0 text-[13px] font-medium text-radar-ink-500">{label}</div>
          <div className={cn(valueColor, 'whitespace-nowrap text-[18px] leading-6')}>{value}</div>
        </div>
      ) : (
        <>
          <div className="text-[13px] font-medium text-radar-ink-500">{label}</div>
          <div className={cn('mt-1 text-[22px] font-semibold leading-7 tabular-nums', valueColor)}>
            {value}
          </div>
        </>
      )}
      {hint && <div className="mt-0.5 text-[12px] leading-5 text-radar-ink-400">{hint}</div>}
    </div>
  );
}

/** 统计卡数据形态；与 `StatCard` props 对齐。 */
export interface StatCardItem {
  key?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'danger' | 'warn';
}

const STAT_COLUMNS_CLASS = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
} as const;

/** 统计卡组：统一列数与间距，页面只给数据。 */
export function StatCards({
  items,
  columns = 'auto',
  minWidth = 170,
  inline = false,
  className,
}: {
  items: readonly StatCardItem[];
  columns?: keyof typeof STAT_COLUMNS_CLASS | 'auto';
  minWidth?: number;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="admin-stat-grid"
      className={cn(
        'grid gap-3',
        columns === 'auto' ? undefined : STAT_COLUMNS_CLASS[columns],
        className,
      )}
      style={
        columns === 'auto'
          ? { gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }
          : undefined
      }
    >
      {items.map((item) => (
        <StatCard
          key={item.key ?? item.label}
          label={item.label}
          value={item.value}
          hint={item.hint}
          tone={item.tone}
          inline={inline}
        />
      ))}
    </div>
  );
}

/* ────────────────────────── 分段筛选 ────────────────────────── */

/** 分段选项组（胶囊式单选）：浅灰轨道 + 选中浮起成墨黑实心。语义是筛选维度。 */
export function Segmented({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-[8px] border border-radar-ink-200 bg-radar-surface p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-radar-brand text-white'
                : 'text-radar-ink-600 hover:bg-radar-ink-100',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
