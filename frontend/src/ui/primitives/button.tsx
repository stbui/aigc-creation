import * as React from 'react';
import { Button as ShadcnButton } from '~/admin-ui/components/ui/button';
import { cn } from '../lib/cn';

type ShadcnProps = React.ComponentProps<typeof ShadcnButton>;

export interface ButtonProps extends Omit<ShadcnProps, 'variant' | 'size' | 'type'> {
  /** antd 兼容: primary / default / text / link / dashed */
  type?: 'primary' | 'default' | 'text' | 'link' | 'dashed';
  /** antd 兼容: htmlType 映射为原生 type */
  htmlType?: 'button' | 'submit' | 'reset';
  /** antd 兼容: block 撑满父宽 */
  block?: boolean;
  /** antd 兼容: loading 时禁用并显示转圈 */
  loading?: boolean;
  /** antd 兼容: 图标节点 */
  icon?: React.ReactNode;
  size?: 'small' | 'middle' | 'large' | ShadcnProps['size'];
  danger?: boolean;
  variant?: ShadcnProps['variant'];
}

function normalizeVariant(type: ButtonProps['type'], variant: ButtonProps['variant'], danger?: boolean) {
  if (variant) return variant;
  if (danger) return 'destructive';
  if (type === 'primary') return 'default';
  if (type === 'text' || type === 'link') return 'ghost';
  return 'outline';
}

function normalizeSize(size: ButtonProps['size']) {
  if (size === 'small') return 'sm';
  if (size === 'large') return 'lg';
  if (size === 'middle' || size === undefined) return 'default';
  return size;
}

/** antd Button 的兼容壳：保留业务类名，内部用 shadcn Button。 */
export function Button({
  type = 'default',
  htmlType = 'button',
  block,
  loading,
  icon,
  size,
  danger,
  variant,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <ShadcnButton
      type={htmlType}
      variant={normalizeVariant(type, variant, danger)}
      size={normalizeSize(size)}
      disabled={disabled || loading}
      className={cn('ui-btn', block && 'w-full', type === 'link' && 'h-auto p-0', className)}
      {...props}
    >
      {loading ? <span className="state-spinner is-small" aria-hidden /> : icon}
      {children}
    </ShadcnButton>
  );
}
