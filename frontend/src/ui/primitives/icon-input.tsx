import type { ComponentProps, ReactNode } from 'react';

import { InputGroup, InputGroupAddon, InputGroupInput } from '~/admin-ui/components/ui/input-group';

export interface IconInputProps extends ComponentProps<typeof InputGroupInput> {
  /** 输入框前置图标；仅作装饰，不参与读屏名称 */
  icon: ReactNode;
  /** FormControl 注入的插槽标记；由本组件拦截，不覆盖 InputGroup 的槽位 */
  'data-slot'?: string;
}

/** 带前置图标的 shadcn InputGroup 语义封装。 */
export function IconInput({ icon, ...props }: IconInputProps) {
  const inputProps = { ...props };
  delete inputProps['data-slot'];

  return (
    <InputGroup>
      <InputGroupAddon aria-hidden>{icon}</InputGroupAddon>
      <InputGroupInput {...inputProps} />
    </InputGroup>
  );
}
