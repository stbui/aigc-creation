import { Spin } from 'antd';
import type { ReactNode } from 'react';

/**
 * 提交区（sticky 底部）—— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前 ToolShell 与 ProductKit / ProductDetail / ViralClone /
 * FreeCreation 五处各写一遍「提示行 + 高级设置浮层 + 主按钮 + 描述」，
 * 连 class（`pk-submit-actions` / `pk-submit-row` / `pk-primary-btn`）都相同。
 *
 * `settings` 传 ToolSettingsPopover 的 props，字段为 null 时整块不渲染（ToolShell 的修图系
 * 部分页面无高级设置）。
 */
export interface ToolSubmitBarProps {
  submitting: boolean;
  disabled?: boolean;
  /** 按钮主文案（如"免费生图" / "立即生成"） */
  label: string;
  /** 按钮内积分/免费角标 */
  creditLabel?: string;
  /** 按钮下方的固定描述文案 */
  desc?: string;
  /** 按钮上方的提示行 */
  hint?: ReactNode;
  /** 高级设置浮层（整块透传给 ToolSettingsPopover） */
  settings?: ReactNode;
  /** 提交按钮右侧的次要按钮（free-creation 的重置/清空） */
  extra?: ReactNode;
  onSubmit: () => void;
}

export function ToolSubmitBar({
  submitting,
  disabled,
  label,
  creditLabel,
  desc,
  hint,
  settings,
  extra,
  onSubmit,
}: ToolSubmitBarProps) {
  return (
    <div className="pk-submit-actions">
      {hint && <p className="tool-submit-hint">{hint}</p>}
      {settings}
      <div className="pk-submit-row">
        {extra}
        <button type="button" className="pk-primary-btn" disabled={disabled || submitting} onClick={onSubmit}>
          {submitting ? (
            <>
              <Spin size="small" />
              <strong>生成中…</strong>
            </>
          ) : (
            <>
              <strong>{label}</strong>
              {creditLabel && <span className="pk-primary-credit">{creditLabel}</span>}
            </>
          )}
        </button>
      </div>
      {desc && <p className="tool-submit-desc">{desc}</p>}
    </div>
  );
}