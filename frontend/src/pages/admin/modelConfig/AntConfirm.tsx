import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Input, Typography } from 'antd';

/**
 * 模型配置页的操作确认区（页面内，不使用弹窗）。
 *
 * 与后台通用 ConfirmAction 保持同样的非阻塞交互：影响面、变更原因照常展示，
 * 但不再用 Modal 遮挡页面，也不再要求输入确认词。
 */
export function AntConfirm({
  open,
  title,
  description,
  impact,
  danger = false,
  confirmText = '确认',
  loading = false,
  needReason = false,
  reasonPlaceholder = '如：接入备用线路',
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  impact?: string[];
  danger?: boolean;
  /** @deprecated 不再要求输入确认词，保留入参仅为兼容旧调用 */
  requireTyping?: boolean;
  /** @deprecated 同上 */
  typingText?: string;
  confirmText?: string;
  loading?: boolean;
  needReason?: boolean;
  reasonPlaceholder?: string;
  onCancel: () => void;
  onConfirm: (typed: string, reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={`adm-inline-confirm${danger ? ' is-danger' : ''}`}
      role="region"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="adm-inline-confirm-head">
        <div className="adm-inline-confirm-title">{title}</div>
        <Button type="text" size="small" aria-label="关闭" disabled={loading} onClick={onCancel}>
          关闭
        </Button>
      </div>

      {description && <div className="adm-inline-confirm-desc">{description}</div>}

      {impact && impact.length > 0 && (
        <Alert
          type={danger ? 'error' : 'warning'}
          showIcon
          title="影响范围"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
      )}

      {needReason && (
        <div className="adm-inline-confirm-field">
          <Typography.Text type="secondary">变更原因（建议填写，便于审计追溯）</Typography.Text>
          <Input.TextArea
            style={{ marginTop: 6 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            maxLength={200}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      )}

      <div className="adm-inline-confirm-actions">
        <Button onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          type="primary"
          danger={danger}
          loading={loading}
          onClick={() => onConfirm('', reason)}
        >
          {confirmText}
        </Button>
      </div>
    </div>
  );
}
