import type { CSSProperties } from 'react';
import { cn } from '../lib/cn';

export interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  tooltip?: { formatter?: (value: number) => string } | false;
  onChange?: (value: number) => void;
  onChangeComplete?: (value: number) => void;
}

/** antd Slider 的兼容壳：单值场景，保留 min/max/step 与 onChange 语义。 */
export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  disabled,
  className,
  style,
  onChange,
  onChangeComplete,
}: SliderProps) {
  const safeValue = value ?? defaultValue ?? min;
  const percent = max === min ? 0 : ((safeValue - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={safeValue}
      disabled={disabled}
      className={cn('ui-slider', className)}
      style={{ backgroundSize: `${percent}% 100%`, ...style }}
      onChange={(event) => onChange?.(Number(event.target.value))}
      onPointerUp={() => onChangeComplete?.(safeValue)}
    />
  );
}
