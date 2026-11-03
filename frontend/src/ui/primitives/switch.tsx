import { Switch as ShadcnSwitch } from '~/admin-ui/components/ui/switch';
import { cn } from '../lib/cn';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  loading?: boolean;
  size?: 'small' | 'default';
  className?: string;
  onChange?: (checked: boolean) => void;
  /**
   * 无障碍名。
   *
   * 开关本身没有可见文字标签（文字在旁边的 `<span>` 里），只靠位置关联
   * 屏幕阅读器读不出它是干什么的 —— 必须给 aria-label。
   */
  'aria-label'?: string;
}

/** antd Switch 的兼容壳。 */
export function Switch({
  checked,
  defaultChecked,
  disabled,
  loading,
  size = 'default',
  className,
  onChange,
  'aria-label': ariaLabel,
}: SwitchProps) {
  return (
    <ShadcnSwitch
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled || loading}
      size={size === 'small' ? 'sm' : 'default'}
      className={cn('ui-switch', className)}
      aria-label={ariaLabel}
      onCheckedChange={(next) => onChange?.(Boolean(next))}
    />
  );
}
