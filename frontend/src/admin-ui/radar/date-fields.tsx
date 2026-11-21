import { useId, useState, type AriaAttributes } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';

/**
 * 日期选择：按钮 + 日历浮层（`Popover` + `Calendar`）。
 *
 * 与 `fields.tsx` 里的复选 / 文件 / 取色 / 滑块分开，是因为日期控件有一份
 * 自己的字符串 ⇄ Date 转换与中文 locale，且几个列表页的筛选条都要用它。
 *
 * 页面 / URL / 后端一律用 `YYYY-MM-DD` 字符串，组件内部才转 `Date`。
 */

/* ────────────────────────── 日期范围 ────────────────────────── */

/** `YYYY-MM-DD` 字符串转 `Date`；空串与非法值都当作「未选」。 */
function parseDateValue(value: string): Date | undefined {
  if (!value) return undefined;
  const date = parseISO(value);
  return isValid(date) ? date : undefined;
}

/**
 * 日期按钮文案统一 `YYYY-MM-DD`。
 *
 * 之前这里用 `PPP`（2026年11月7日），而筛选芯片、URL 参数、列表列都是
 * `2026-11-07` —— 同一页出现两种日期写法，运营要自己换算。统一成机器口径，
 * 与 URL、导出 CSV、账单日（billDate）完全一致。
 */
function formatDateLabel(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

type DateFieldAriaProps = Pick<
  AriaAttributes,
  'aria-describedby' | 'aria-invalid' | 'aria-required'
>;

/**
 * 单日期选择：按钮 + 日历浮层（`Popover` + `Calendar mode="single"`，
 * 与 shadcn Date Picker 示例同构）。
 *
 * 对外仍用 `YYYY-MM-DD` 字符串，避免调用方处理时区与 Date 对象。
 * `minDate` / `maxDate` 只禁用日历里越界的日期，不改变已传入的值。
 */
export function DateField({
  value,
  onChange,
  ariaLabel = '选择日期',
  id,
  minDate,
  maxDate,
  disabled = false,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-required': ariaRequired,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  id?: string;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
  className?: string;
} & DateFieldAriaProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const min = parseDateValue(minDate ?? '');
  const max = parseDateValue(maxDate ?? '');
  const disabledDates = [
    ...(min ? [{ before: min }] : []),
    ...(max ? [{ after: max }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          id={id}
          data-testid="admin-date"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={ariaRequired}
          disabled={disabled}
          className={cn('w-full justify-start px-2.5 font-normal shadow-none', className)}
        >
          <CalendarIcon />
          {selected ? (
            formatDateLabel(selected)
          ) : (
            <span className="text-muted-foreground">选择日期</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="admin-portal radar-scope w-auto rounded-[8px] border-radar-ink-200 p-0 shadow-none"
        align="start"
      >
        <Calendar
          mode="single"
          locale={zhCN}
          defaultMonth={selected ?? max ?? min}
          selected={selected}
          disabled={disabledDates}
          onSelect={(date) => {
            onChange(date ? format(date, 'yyyy-MM-dd') : '');
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * 日期范围选择：按钮 + 双月日历浮层（`Popover` + `Calendar mode="range"`，
 * 与 shadcn Date Picker Range 示例同构）。筛选条里与其它无标签控件同排，
 * **不渲染可见标签**，用途由按钮内的日历图标与占位文案表达。
 *
 * 页面/URL/后端都按 `YYYY-MM-DD` 字符串传值，组件内部才转成 `Date` 交给
 * DayPicker。日期显示与日历统一用中文 locale。
 */
export function DateRangeField({
  from,
  to,
  onChange,
  ariaLabel = '日期范围',
  className,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const id = useId();

  const fromDate = parseDateValue(from);
  const toDate = parseDateValue(to);
  const selected: DateRange | undefined = fromDate ? { from: fromDate, to: toDate } : undefined;

  const handleSelect = (range: DateRange | undefined) => {
    onChange({
      from: range?.from ? format(range.from, 'yyyy-MM-dd') : '',
      to: range?.to ? format(range.to, 'yyyy-MM-dd') : '',
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          id={id}
          data-testid="admin-date-range"
          aria-label={ariaLabel}
          className={cn('justify-start px-2.5 font-normal shadow-none', className)}
        >
          <CalendarIcon />
          {fromDate ? (
            toDate ? (
              <>
                {formatDateLabel(fromDate)} - {formatDateLabel(toDate)}
              </>
            ) : (
              formatDateLabel(fromDate)
            )
          ) : (
            <span className="text-muted-foreground">选择日期</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="admin-portal radar-scope w-auto rounded-[8px] border-radar-ink-200 p-0 shadow-none"
        align="start"
      >
        <Calendar
          mode="range"
          locale={zhCN}
          defaultMonth={fromDate}
          selected={selected}
          onSelect={handleSelect}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
