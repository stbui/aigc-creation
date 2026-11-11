import { Minus, Plus } from 'lucide-react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '~/admin-ui/components/ui/input-group';
import { cn } from '../lib/cn';

export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  /** 下界，默认 0；输入与步进都夹取到该值 */
  min?: number;
  /** 上界；省略即不设上限 */
  max?: number;
  /** 每次步进的增量，默认 1 */
  step?: number;
  disabled?: boolean;
  /** 数值名称：读屏文案据此拼成「减少{label}」「增加{label}」 */
  label: string;
  /** 输入框读屏名称，默认与 label 相同 */
  inputLabel?: string;
  className?: string;
}

/**
 * 数量步进器（− 数值 +）。
 *
 * 走 shadcn `InputGroup` 组合件：输入框与两侧步进按钮共享同一圈边框与聚焦环，
 * 不再手写三段网格与伪元素去覆盖原生 number 步进器。上下界由 min/max 决定，
 * 输入与按钮点击共用同一套「取整 → 夹取」规则；到界时对应按钮禁用。
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
  label,
  inputLabel,
  className,
}: NumberStepperProps) {
  const clamp = (next: number) => {
    let result = Math.round(next);
    if (!Number.isFinite(result)) result = min;
    result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  };

  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  const stepBy = (delta: number) => {
    if (disabled) return;
    onChange(clamp(value + delta * step));
  };

  return (
    <InputGroup
      data-slot="number-stepper"
      className={cn('h-8 w-[120px] rounded-none shadow-none', className)}
    >
      <InputGroupAddon align="inline-start" className="h-full p-0 has-[>button]:m-0">
        <InputGroupButton
          size="icon-xs"
          aria-label={`减少${label}`}
          disabled={disabled || atMin}
          onClick={() => stepBy(-1)}
          className="h-full rounded-none text-muted-foreground hover:text-brand"
        >
          <Minus aria-hidden />
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupInput
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        aria-label={inputLabel ?? label}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        className={cn(
          'h-full text-center text-sm tabular-nums',
          '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
      <InputGroupAddon align="inline-end" className="h-full p-0 has-[>button]:m-0">
        <InputGroupButton
          size="icon-xs"
          aria-label={`增加${label}`}
          disabled={disabled || atMax}
          onClick={() => stepBy(1)}
          className="h-full rounded-none text-muted-foreground hover:text-brand"
        >
          <Plus aria-hidden />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
