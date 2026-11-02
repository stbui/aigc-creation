import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/* antd 的展示型小件兼容层。C 端只使用最朴素的形态。 */

export function Tag({
  children,
  className,
  color,
}: {
  children?: ReactNode;
  className?: string;
  color?: string;
  variant?: string;
}) {
  return (
    <span className={cn('ui-tag', className)} data-color={color}>
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  title,
  extra,
  variant,
  size,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  extra?: ReactNode;
  variant?: string;
  size?: string;
}) {
  return (
    <section className={cn('ui-card', size === 'small' && 'is-small', className)}>
      {(title || extra) && (
        <header className="ui-card-head">
          {title && <div className="ui-card-title">{title}</div>}
          {extra}
        </header>
      )}
      <div className="ui-card-body">{children}</div>
    </section>
  );
}

export function Row({
  children,
  className,
  gutter,
}: {
  children?: ReactNode;
  className?: string;
  gutter?: number | [number, number];
}) {
  return <div className={cn('ui-row', className)}>{children}</div>;
}

export function Col({
  children,
  className,
  span,
  xs,
  sm,
}: {
  children?: ReactNode;
  className?: string;
  span?: number;
  xs?: number;
  sm?: number;
}) {
  return (
    <div
      className={cn('ui-col', className)}
      data-span={span}
      data-xs={xs}
      data-sm={sm}
    >
      {children}
    </div>
  );
}

export function Alert({
  message,
  title,
  description,
  type = 'info',
  showIcon,
  className,
}: {
  message?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  type?: 'success' | 'info' | 'warning' | 'error';
  showIcon?: boolean;
  className?: string;
  variant?: string;
}) {
  return (
    <div className={cn('ui-alert', `is-${type}`, className)} role="alert">
      <strong>{message ?? title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function Typography({ children, className }: { children?: ReactNode; className?: string }) {
  return <span className={className}>{children}</span>;
}

Typography.Title = function Title({
  children,
  level = 3,
  className,
}: {
  children?: ReactNode;
  level?: 1 | 2 | 3 | 4 | 5;
  className?: string;
}) {
  const TagName = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5';
  return <TagName className={className}>{children}</TagName>;
};

Typography.Text = function Text({
  children,
  className,
  type,
}: {
  children?: ReactNode;
  className?: string;
  type?: string;
}) {
  return <span className={cn(type === 'secondary' && 'ui-text-secondary', className)}>{children}</span>;
};

Typography.Paragraph = function Paragraph({
  children,
  className,
  type,
}: {
  children?: ReactNode;
  className?: string;
  type?: string;
}) {
  return (
    <p className={cn(type === 'secondary' && 'ui-text-secondary', className)}>{children}</p>
  );
};
