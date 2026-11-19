import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * 文本排版小件。
 *
 * Tag / Card / Row / Col / Alert 已改为直连 shadcn（StatusBadge / Surface /
 * InlineAlert），只有 Typography 在 shadcn 没有对应物，继续保留这个纯文本包装。
 */
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