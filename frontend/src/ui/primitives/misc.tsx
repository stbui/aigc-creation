import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/* antd 的展示型小件兼容层。C 端只使用最朴素的形态。 */

export function Tag({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <span className={cn('ui-tag', className)}>{children}</span>;
}

export function Card({
  children,
  className,
  title,
  extra,
  size,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  extra?: ReactNode;
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
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <div className={cn('ui-row', className)}>{children}</div>;
}

export function Col({
  children,
  className,
  sm,
}: {
  children?: ReactNode;
  className?: string;
  sm?: number;
}) {
  return (
    <div className={cn('ui-col', className)} data-sm={sm}>
      {children}
    </div>
  );
}

export function Alert({
  message,
  title,
  description,
  type = 'info',
  className,
}: {
  message?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  type?: 'success' | 'info' | 'warning' | 'error';
  className?: string;
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
