import * as React from 'react';
import { Textarea as ShadcnTextarea } from '~/admin-ui/components/ui/textarea';
import { cn } from '../lib/cn';

export type TextareaProps = React.ComponentProps<typeof ShadcnTextarea>;

/**
 * shadcn Textarea 的兼容件。
 *
 * 页面已有的文本域皮肤（`.pk-desc-editor textarea` / `.pk-expand-textarea` …）
 * 是未分层样式，会覆盖原子件自带的尺寸与边框；这里只统一字段宽度与
 * `field-sizing: fixed`，保证传了 `rows` 的文本域仍按行数排版。
 */
export function Textarea({ className, ...props }: TextareaProps) {
  return <ShadcnTextarea className={cn('ui-textarea field-sizing-fixed', className)} {...props} />;
}
