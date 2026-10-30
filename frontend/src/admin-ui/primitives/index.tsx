import type { ReactNode } from 'react';
import { cx } from '../lib/cn';

/**
 * BoardUI 免费层没有的基础件。
 *
 * 后台 29 页原先依赖 antd 的 Card / Empty / Skeleton / Result / Descriptions /
 * Steps / Form.Item，换成 BoardUI 后这些形态必须补上，否则每页各写一套
 * 空态、骨架和错误展示。这里只做后台需要的形态，不做通用组件库。
 */

/** 分区容器。后台不用卡片墙，标题与内容靠发丝线分区。 */
export function Panel({
  title,
  note,
  extra,
  isNarrow = false,
  children,
  className,
}: {
  title?: ReactNode;
  note?: ReactNode;
  extra?: ReactNode;
  /** 窄版：表单型页面限制内容宽度，避免视线横跨半个屏幕 */
  isNarrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'mb-3 rounded-xl border border-border-table bg-white',
        isNarrow && 'max-w-[760px]',
        className,
      )}
    >
      {(title || extra) && (
        <header className="flex items-center gap-3 border-b border-border-table px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold text-text-primary">{title}</h2>}
            {note && <p className="mt-0.5 text-xs text-text-tertiary">{note}</p>}
          </div>
          {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** 空态：说明为什么空 + 下一步能做什么，不留一片白 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-text-tertiary [&>svg]:size-8">{icon}</div>}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description && <p className="max-w-md text-xs leading-5 text-text-tertiary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** 骨架屏。列表加载时保持布局稳定，避免内容跳动。 */
export function Skeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse rounded-lg bg-background-secondary-default"
          style={{ animationDelay: `${index * 80}ms` }}
        />
      ))}
    </div>
  );
}

/** 结果页 / 失败页：错误必须可读、可重试。 */
export function Result({
  tone = 'error',
  title,
  description,
  actions,
}: {
  tone?: 'error' | 'success' | 'info';
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const toneClass =
    tone === 'error' ? 'border-rose-200 bg-rose-50' : tone === 'success' ? 'border-emerald-200 bg-emerald-50' : 'border-border-table bg-background-secondary-default';
  return (
    <div className={cx('rounded-xl border p-6', toneClass)}>
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {description && <div className="mt-1 text-xs leading-5 text-text-secondary">{description}</div>}
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  );
}

/** 键值描述列表：详情页的信息层级靠「标签 / 值」两列，不靠卡片嵌套。 */
export function Descriptions({
  items,
  columns = 1,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 1 | 2 | 3;
}) {
  const colClass = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <dl className={cx('grid grid-cols-1 gap-x-6 gap-y-3', colClass)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs text-text-tertiary">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 步骤条：状态流转用「已完成 / 当前 / 未开始」三态，不画进度动画。 */
export function Steps({
  items,
  className,
}: {
  items: Array<{ title: ReactNode; description?: ReactNode; done?: boolean; active?: boolean }>;
  className?: string;
}) {
  return (
    <ol className={cx('flex flex-col gap-0', className)}>
      {items.map((item, index) => {
        const state = item.done ? 'done' : item.active ? 'active' : 'todo';
        return (
          <li key={index} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cx(
                  'mt-1 size-2.5 shrink-0 rounded-full border-2',
                  state === 'done' && 'border-accent-500 bg-accent-500',
                  state === 'active' && 'border-accent-500 bg-white',
                  state === 'todo' && 'border-neutral-300 bg-white',
                )}
                aria-hidden
              />
              {index < items.length - 1 && <span className="w-px flex-1 bg-border-table" aria-hidden />}
            </div>
            <div className={cx('pb-4', index === items.length - 1 && 'pb-0')}>
              <p
                className={cx(
                  'text-sm',
                  state === 'todo' ? 'text-text-tertiary' : 'font-medium text-text-primary',
                )}
              >
                {item.title}
              </p>
              {item.description && (
                <div className="mt-0.5 text-xs leading-5 text-text-tertiary">{item.description}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 表单字段容器。
 *
 * 校验错误由调用方给（后端错误码优先），这里只负责「标签 / 必填标记 /
 * 说明 / 错误」四个位置固定，避免每页自己拼。
 */
export function FormField({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-secondary">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-text-tertiary">{hint}</p>
      )}
    </div>
  );
}
