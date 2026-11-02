import { cn } from '../lib/cn';

/** antd Spin 的兼容件：尺寸/颜色沿用项目已有的 `.state-spinner`。 */
export function Spin({
  size = 'default',
  className,
}: {
  size?: 'small' | 'default' | 'large';
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={cn(
        'state-spinner',
        size === 'small' && 'is-small',
        size === 'large' && 'is-large',
        className,
      )}
    />
  );
}
