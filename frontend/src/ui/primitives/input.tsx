import * as React from 'react';
import { Input as ShadcnInput } from '~/admin-ui/components/ui/input';
import { cn } from '../lib/cn';

type ShadcnProps = React.ComponentProps<typeof ShadcnInput>;

export interface InputProps extends Omit<ShadcnProps, 'size' | 'prefix'> {
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** antd 兼容 */
  allowClear?: boolean;
  size?: 'small' | 'middle' | 'large';
  onPressEnter?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

function InputBase({
  className,
  prefix,
  suffix,
  size: _size,
  allowClear: _allowClear,
  onPressEnter,
  onKeyDown,
  ...props
}: InputProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.key === 'Enter') onPressEnter?.(event);
  };
  /*
   * 表单注入的 value 初始是 undefined（字段还没填过）。直接透传会让 input
   * 先以非受控挂载、再切受控，React 会警告且光标可能跳动；显式传了 value 时
   * 统一收敛成字符串，未传（页面自管非受控输入）时保持原样。
   */
  const inputProps = 'value' in props ? { ...props, value: props.value ?? '' } : props;
  if (!prefix && !suffix) {
    return (
      <ShadcnInput
        className={cn('ant-input ui-input', className)}
        onKeyDown={handleKeyDown}
        {...inputProps}
      />
    );
  }
  return (
    <span className={cn('login-input-wrap ant-input-affix-wrapper', className)}>
      {prefix && <span className="login-input-prefix">{prefix}</span>}
      <ShadcnInput className="login-input-inner ant-input" onKeyDown={handleKeyDown} {...inputProps} />
      {suffix && <span className="login-input-suffix">{suffix}</span>}
    </span>
  );
}

/** antd Input 的兼容壳，含 `.Password` / `.TextArea`。 */
export const Input = Object.assign(InputBase, {
  Password: function Password(props: Omit<InputProps, 'type'>) {
    return <InputBase {...props} type="password" />;
  },
  TextArea: function TextArea({
    className,
    rows = 3,
    showCount,
    maxLength,
    ...props
  }: React.ComponentProps<'textarea'> & { showCount?: boolean }) {
    // 与 InputBase 同理：注入的 undefined 要先收敛成空串，避免非受控/受控来回切换
    const value = 'value' in props ? (props.value ?? '') : undefined;
    const length = typeof value === 'string' ? value.length : 0;
    return (
      <span className="login-textarea-wrap">
        <textarea
          className={cn('login-textarea', className)}
          rows={rows}
          maxLength={maxLength}
          {...props}
          value={value}
        />
        {showCount && maxLength !== undefined && (
          <span className="login-textarea-count">
            {length}/{maxLength}
          </span>
        )}
      </span>
    );
  },
});
