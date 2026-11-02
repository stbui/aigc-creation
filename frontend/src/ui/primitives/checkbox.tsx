import * as React from 'react';
import { Checkbox as ShadcnCheckbox } from '~/admin-ui/components/ui/checkbox';
import { cn } from '../lib/cn';

export interface CheckboxProps
  extends Omit<React.ComponentProps<typeof ShadcnCheckbox>, 'checked' | 'onCheckedChange' | 'onChange'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (event: { target: { checked: boolean } }) => void;
}

/** antd Checkbox 的兼容壳。 */
export function Checkbox({ checked, defaultChecked, onChange, className, ...props }: CheckboxProps) {
  return (
    <ShadcnCheckbox
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(next) => onChange?.({ target: { checked: Boolean(next) } })}
      className={cn('align-middle', className)}
      {...props}
    />
  );
}
