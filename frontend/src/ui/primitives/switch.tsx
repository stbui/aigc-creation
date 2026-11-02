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
}: SwitchProps) {
  return (
    <ShadcnSwitch
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled || loading}
      size={size === 'small' ? 'sm' : 'default'}
      className={cn('ui-switch', className)}
      onCheckedChange={(next) => onChange?.(Boolean(next))}
    />
  );
}
