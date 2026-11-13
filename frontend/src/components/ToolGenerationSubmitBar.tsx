import type { ReactNode } from 'react';

import { ModelPicker } from './ModelPicker';
import { ToolSettingsPopover, type ToolSettingsPopoverProps } from './ToolSettingsPopover';
import { ToolSubmitBar } from './ToolSubmitBar';
import type { PublicModelGroup } from '../lib/models';

export interface ToolGenerationSubmitBarProps {
  /** 能力 id（与后端 capability.registry 一致） */
  capability: string;
  generating: boolean;
  disabled: boolean;
  label?: string;
  /** 传了即启用登录墙（未登录显示该文案并唤起登录弹窗） */
  guestLabel?: string;
  creditLabel?: string | null;
  /** 按钮上方的提示行 */
  hint?: ReactNode;
  /** 按钮上方的整块提示节点（能力不可用 / 最近一次失败） */
  notice?: ReactNode;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;
  onModelChange?: (model: PublicModelGroup | null) => void;
  /** 高级设置浮层的差异项（自定义头部 / 类名等） */
  settingsProps?: Partial<ToolSettingsPopoverProps>;
  /** 外层容器类名；不传时不额外包一层 DOM */
  className?: string;
  onSubmit: () => void;
}

/**
 * 生成提交区：不可用提示 + 高级设置（模型 / 比例 / 画质）+ 主按钮。
 *
 * 工具页左栏底部是同一块结构：`ToolSubmitBar` + `ToolSettingsPopover` +
 * `ModelPicker`。商品主图 / 商品详情 / 爆款复刻 / 创作页只在文案与提示行上不同，
 * 模型选择器与报价回调的接线在这里定义一次，避免各页漂移。
 */
export function ToolGenerationSubmitBar({
  capability,
  generating,
  disabled,
  label = '立即生成',
  guestLabel,
  creditLabel,
  hint,
  notice,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  onModelQuoteChange,
  onModelChange,
  settingsProps,
  className,
  onSubmit,
}: ToolGenerationSubmitBarProps) {
  const { modelPicker, ...restSettingsProps } = settingsProps ?? {};
  const content = (
    <>
      {notice}
      <ToolSubmitBar
        submitting={generating}
        disabled={disabled}
        label={label}
        guestLabel={guestLabel}
        creditLabel={creditLabel ?? undefined}
        hint={hint}
        settings={
          <ToolSettingsPopover
            open={settingsOpen}
            onToggle={onToggleSettings}
            ratio={ratio}
            onRatioChange={onRatioChange}
            resolution={resolution}
            onResolutionChange={onResolutionChange}
            capabilityId={capability}
            {...restSettingsProps}
            modelPicker={
              modelPicker ?? (
                <ModelPicker
                  capability={capability}
                  options={{ ratio, resolution }}
                  onQuoteChange={onModelQuoteChange}
                  onModelChange={onModelChange}
                />
              )
            }
          />
        }
        onSubmit={onSubmit}
      />
    </>
  );

  return className ? <div className={className}>{content}</div> : content;
}
