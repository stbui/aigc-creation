import { ChevronDown } from 'lucide-react';

import { ratioOptions, resolutionOptions } from './utils';
import {
  Badge,
  Button,
  FieldLegend,
  FieldSet,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from './components';

/**
 * 提交区的高级设置浮层（比例 + 画质）。
 *
 * 2026-11-21 由自绘 `image-output-settings-*` 折叠壳改为 shadcn `Popover`：
 * 展开态、点外关闭、Esc 关闭与焦点归还都由 Radix 承担，不再手写绝对定位面板
 * 与 document 监听。触发器是 shadcn `Button`（摘要 + 两个 `Badge` 胶囊），
 * 两组选项各用一个单选 `ToggleGroup`。
 *
 * 与共享 `ToolSettingsPopover` 的差异只剩内容编排：本页两组选项的卡片几何
 * 按参考站实测（比例 4 列 39px 高、画质 3 列 62px 高），组内仍用 shadcn 原子件。
 */
export function MultiFusionOutputSettings({
  open,
  ratio,
  resolution,
  onToggle,
  onRatioChange,
  onResolutionChange,
}: {
  open: boolean;
  ratio: string;
  resolution: string;
  onToggle: () => void;
  onRatioChange: (value: string) => void;
  onResolutionChange: (value: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={(next) => next !== open && onToggle()}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="高级设置"
          className="h-8.5 w-full justify-start gap-2 rounded-md border-0 bg-card px-2.5 text-xs font-normal text-muted-foreground"
        >
          <span className="mr-auto text-xs font-semibold text-foreground">高级设置</span>
          <Badge variant="outline" className="h-7 rounded-[5px] px-2.25 text-xs font-normal">
            比例 {ratio}
          </Badge>
          <Badge variant="outline" className="h-7 rounded-[5px] px-2.25 text-xs font-normal">
            画质 {resolution.toUpperCase()}
          </Badge>
          <ChevronDown
            aria-hidden
            className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="z-[1600] w-[var(--radix-popover-trigger-width)] min-w-0 gap-4.75 rounded-xl border border-border bg-card p-4 shadow-card"
      >
        {/* 图片比例 */}
        <FieldSet className="gap-2.5">
          <FieldLegend variant="label" className="mb-0 text-xs font-medium text-foreground">
            图片比例
          </FieldLegend>
          <ToggleGroup
            type="single"
            value={ratio}
            onValueChange={(next) => next && onRatioChange(next)}
            aria-label="图片比例选项"
            variant="outline"
            size="sm"
            spacing={2.5}
            className="grid w-full grid-cols-4"
          >
            {ratioOptions('multi_fusion').map((option) => {
              const value = String(option.value);
              return (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="h-9.75 min-w-0 rounded-md border-border bg-card text-xs font-medium text-muted-foreground data-[state=on]:border-brand data-[state=on]:bg-brand-bg data-[state=on]:text-brand"
                >
                  {value}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </FieldSet>

        {/* 分辨率 */}
        <FieldSet className="gap-2.5">
          <FieldLegend variant="label" className="mb-0 text-xs font-medium text-foreground">
            分辨率（积分/权益消耗）
          </FieldLegend>
          <ToggleGroup
            type="single"
            value={resolution}
            onValueChange={(next) => next && onResolutionChange(next)}
            aria-label="分辨率选项"
            variant="outline"
            size="sm"
            spacing={2.5}
            className="grid w-full grid-cols-3"
          >
            {resolutionOptions('multi_fusion').map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={String(option.value)}
                disabled={option.disabled}
                title={option.disabled ? option.disabledReason : undefined}
                className="group/toggle grid h-15.5 min-w-0 place-items-center gap-1 rounded-md border-border bg-card p-2 data-[state=on]:border-brand data-[state=on]:bg-brand-bg data-[state=on]:text-brand disabled:opacity-[0.56] data-[state=on]:disabled:opacity-100"
              >
                <strong className="text-xs leading-none font-medium">
                  {option.shortLabel ?? option.label}
                </strong>
                <span className="text-xs font-normal text-muted-foreground group-data-[state=on]/toggle:text-brand">
                  {option.sub}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>
      </PopoverContent>
    </Popover>
  );
}
