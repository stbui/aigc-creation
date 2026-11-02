import type { ReactNode } from 'react';

export interface EmptyProps {
  image?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** antd Empty 的兼容壳。 */
export function Empty({ description = '暂无数据', className, children }: EmptyProps) {
  return (
    <div className={className ? `ui-empty ${className}` : 'ui-empty'} role="status">
      {children}
      <span className="ui-empty-text">{description}</span>
    </div>
  );
}
