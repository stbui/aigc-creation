import { useState, type ReactNode } from 'react';
import { Popover } from './popover';

export interface PopconfirmProps {
  title: ReactNode;
  description?: ReactNode;
  okText?: string;
  cancelText?: string;
  okButtonProps?: { danger?: boolean; disabled?: boolean; loading?: boolean };
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  children: ReactNode;
  disabled?: boolean;
}

/** antd Popconfirm 的兼容壳：点击确认后关闭。 */
export function Popconfirm({
  title,
  description,
  okText = '确定',
  cancelText = '取消',
  okButtonProps,
  onConfirm,
  onCancel,
  children,
  disabled,
}: PopconfirmProps) {
  const [open, setOpen] = useState(false);

  const cancel = () => {
    setOpen(false);
    onCancel?.();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => !disabled && setOpen(next)}
      content={
        <div className="ui-popconfirm">
          <div className="ui-popconfirm-title">{title}</div>
          {description && <div className="ui-popconfirm-desc">{description}</div>}
          <div className="ui-popconfirm-actions">
            <button type="button" className="ui-btn is-ghost" onClick={cancel}>
              {cancelText}
            </button>
            <button
              type="button"
              className={`ui-btn ${okButtonProps?.danger ? 'is-danger' : 'is-primary'}`}
              disabled={okButtonProps?.disabled || okButtonProps?.loading}
              onClick={() => {
                setOpen(false);
                void onConfirm?.();
              }}
            >
              {okText}
            </button>
          </div>
        </div>
      }
    >
      {children}
    </Popover>
  );
}
