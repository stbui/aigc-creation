import { useEffect, useState } from 'react';
import {
  ConfirmDialog,
  SelectField,
  TextAreaField,
} from '~/admin-ui/primitives';
import type { AdminTicketAssignee } from '../../../types/api';

/**
 * 转交工单。
 *
 * 只做「内部备注 + 指派 + processing」，不退款、不改积分。接收人由
 * `GET /admin/tickets/assignees` 提供，只含启用中的后台账号。
 */
export function TicketTransferDialog({
  open,
  ticketNo,
  assignees,
  defaultAssigneeId,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  ticketNo: string;
  assignees: AdminTicketAssignee[];
  defaultAssigneeId?: string | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (assigneeId: string, note: string) => void;
}) {
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setAssigneeId(defaultAssigneeId ?? '');
    setNote('');
  }, [open, defaultAssigneeId]);

  return (
    <ConfirmDialog
      open={open}
      title={`转交工单 ${ticketNo}`}
      confirmText="确认转交"
      loading={loading}
      confirmDisabled={!assigneeId}
      onCancel={onCancel}
      onConfirm={() => onConfirm(assigneeId, note)}
      description={
        <p>
          工单会指派给接收人并进入「处理中」。转交只交接上下文，
          <b>不执行退款或积分调整</b>；资金动作仍由财务在订单模块完成。
        </p>
      }
      impact={['接收人会在工作台「指派给我」中看到该工单', '状态变为处理中，用户端可见']}
      extra={
        <div className="flex flex-col gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-foreground">接收人</span>
            <SelectField
              ariaLabel="转交接收人"
              placeholder="选择后台账号"
              value={assigneeId || undefined}
              onChange={(value) => setAssigneeId(value ?? '')}
              options={assignees.map((assignee) => ({
                value: assignee.id,
                label: `${assignee.name}（${assignee.role}）`,
              }))}
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-foreground">交接备注</span>
            <TextAreaField
              ariaLabel="交接备注"
              rows={4}
              maxLength={2000}
              showCount
              value={note}
              onChange={setNote}
              placeholder="例如：用户申请退款，订单已核实，请在订单模块处理。"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              备注只对后台可见，不会推送给用户。
            </p>
          </div>
        </div>
      }
    />
  );
}
