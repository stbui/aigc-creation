import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * 提交区（sticky 底部）—— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前 ToolShell 与 ProductKit / ProductDetail / ViralClone /
 * FreeCreation 五处各写一遍「提示行 + 高级设置浮层 + 主按钮 + 描述」，
 * 连 class（`pk-submit-actions` / `pk-submit-row` / `pk-primary-btn`）都相同。
 *
 * `settings` 传 ToolSettingsPopover 的 props，字段为 null 时整块不渲染（ToolShell 的修图系
 * 部分页面无高级设置）。
 *
 * 登录墙（2026-10-19，与参考站 free-creation 同构）:
 *   传 `guestLabel` 时启用 —— 未登录主文案切成 `guestLabel`（如「登录免费生成」），
 *   隐藏积分角标，点击不提交而是唤起登录弹窗；登录成功后停在原页。
 *   不传则保持原行为（未登录点提交 → api 401 → `auth:required` 事件 → 同样弹登录框）。
 */
export interface ToolSubmitBarProps {
  submitting: boolean;
  disabled?: boolean;
  /** 按钮主文案（如"免费生图" / "立即生成"） */
  label: string;
  /** 未登录时的主文案；传了即启用登录墙（未登录 → 显示该文案 + 点击弹登录） */
  guestLabel?: string;
  /** 按钮内积分/免费角标（仅登录态显示） */
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
  guestLabel,
  creditLabel,
  desc,
  hint,
  settings,
  extra,
  onSubmit,
}: ToolSubmitBarProps) {
  const { token, openLogin } = useAuth();
  const guest = Boolean(guestLabel) && !token;

  // 表单条件不满足一律 disabled（含未登录态）: 提示词为空时按钮置灰是硬约束。
  // 未登录只影响主文案与点击后的动作, 不影响置灰 —— 否则会出现「登录按钮灰着点不动」。
  const btnDisabled = submitting || Boolean(disabled);

  return (
    <div className="pk-submit-actions">
      {hint && <p className="tool-submit-hint">{hint}</p>}
      {settings}
      <div className="pk-submit-row">
        {extra}
        <button
          type="button"
          className="pk-primary-btn"
          disabled={btnDisabled}
          onClick={() => {
            if (guest) openLogin();
            else onSubmit();
          }}
        >
          {submitting ? (
            <>
              <Spin size="small" />
              <strong>生成中…</strong>
            </>
          ) : (
            <>
              <strong>{guest ? guestLabel : label}</strong>
              {!guest && creditLabel && <span className="pk-primary-credit">{creditLabel}</span>}
            </>
          )}
        </button>
      </div>
      {desc && <p className="tool-submit-desc">{desc}</p>}
    </div>
  );
}