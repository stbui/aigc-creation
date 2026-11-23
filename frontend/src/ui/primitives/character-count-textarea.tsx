import { useId, type ComponentProps } from 'react';

import { FieldDescription } from '~/admin-ui/components/ui/field';
import { Textarea } from '~/admin-ui/components/ui/textarea';
import { cn } from '../lib/cn';

export interface CharacterCountTextareaProps
  extends Omit<ComponentProps<typeof Textarea>, 'maxLength' | 'value'> {
  value?: string;
  maxLength: number;
}

/** 带字符计数的 shadcn Textarea 语义封装；计数通过 aria-describedby 关联到控件。 */
export function CharacterCountTextarea({
  id,
  className,
  value,
  maxLength,
  'aria-describedby': ariaDescribedBy,
  ...props
}: CharacterCountTextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const countId = `${textareaId}-count`;
  const describedBy = [ariaDescribedBy, countId].filter(Boolean).join(' ');

  return (
    <div className="flex w-full flex-col gap-1">
      <Textarea
        id={textareaId}
        value={value ?? ''}
        maxLength={maxLength}
        aria-describedby={describedBy || undefined}
        className={cn('field-sizing-fixed', className)}
        {...props}
      />
      <FieldDescription id={countId} className="text-right text-xs tabular-nums">
        {value?.length ?? 0}/{maxLength}
      </FieldDescription>
    </div>
  );
}
