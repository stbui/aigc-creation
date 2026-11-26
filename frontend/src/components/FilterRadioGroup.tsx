import { cn, RadioGroup, RadioGroupItem } from '../ui';

export interface FilterRadioOption<T extends string = string> {
  id: T;
  label: string;
}

export interface FilterRadioGroupProps<T extends string = string> {
  options?: Array<FilterRadioOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  idPrefix?: string;
}

/**
 * 通用筛选单选组。
 *
 * 用 RadioGroup 提供单选语义、方向键切换和 aria-checked；RadioGroupItem
 * 视觉隐藏，外层 label 负责呈现分段胶囊。可用于日期、来源或其他互斥筛选。
 */
export function FilterRadioGroup<T extends string = string>({
  options = [],
  value,
  onChange,
  ariaLabel,
  idPrefix = 'filter',
}: FilterRadioGroupProps<T>) {
  return (
    <RadioGroup
      className="flex h-[34px] items-center gap-px rounded-[9px] border border-[var(--border-soft)] bg-[var(--surface-4)] p-[var(--space-2)]"
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => onChange(next as T)}
    >
      {options.map((option) => {
        const selected = value === option.id;
        const optionId = `${idPrefix}-${option.id}`;

        return (
          <label
            key={option.id}
            htmlFor={optionId}
            className={cn(
              'relative inline-flex h-7 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-[7px] border-0 px-[var(--space-8)] text-xs font-[inherit] text-[var(--alp-text-7)] outline-none transition-colors',
              'hover:text-[var(--brand)]',
              'has-[[data-slot=radio-group-item]:focus-visible]:outline-2 has-[[data-slot=radio-group-item]:focus-visible]:outline-[var(--brand)] has-[[data-slot=radio-group-item]:focus-visible]:outline-offset-1',
              selected &&
                'bg-[var(--card-bg)] font-semibold text-[var(--brand)] shadow-[0_1px_4px_rgb(43_45_83_/_0.102)]',
            )}
          >
            <RadioGroupItem id={optionId} value={option.id} aria-label={option.label} className="sr-only" />
            {option.label}
          </label>
        );
      })}
    </RadioGroup>
  );
}
