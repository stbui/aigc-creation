import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Input, Modal, Space, Typography } from 'antd';

/**
 * antd Modal 版确认框。
 *
 * 后台通用的 ConfirmAction 是自绘 div；本页按「整页 antd 化」的要求改用 Modal，
 * 但保留三件业务语义：量化影响、危险操作输入确认词、变更原因。
 */
export function AntConfirm({
  open,
  title,
  description,
  impact,
  danger = false,
  requireTyping,
  typingText,
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
  requireTyping?: boolean;
  typingText?: string;
  confirmText?: string;
  loading?: boolean;
  needReason?: boolean;
  reasonPlaceholder?: string;
  onCancel: () => void;
  onConfirm: (typed: string, reason: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setTyped('');
      setReason('');
    }
  }, [open]);

  const ready = !requireTyping || typed.trim() === (typingText ?? '');

  return (
    <Modal
      open={open}
      title={title}
      width={540}
      okText={confirmText}
      cancelText="取消"
      confirmLoading={loading}
      okButtonProps={{ danger, disabled: !ready }}
      mask={{ closable: !loading }}
      onCancel={onCancel}
      onOk={() => onConfirm(typed, reason)}
      destroyOnHidden
    >
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        {description && <Typography.Paragraph style={{ margin: 0 }}>{description}</Typography.Paragraph>}

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

        {requireTyping && (
          <div>
            <Typography.Text type="secondary">
              请输入「{typingText}」以确认
            </Typography.Text>
            <Input
              style={{ marginTop: 6 }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typingText}
              autoComplete="off"
            />
          </div>
        )}

        {needReason && (
          <div>
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
      </Space>
    </Modal>
  );
}
