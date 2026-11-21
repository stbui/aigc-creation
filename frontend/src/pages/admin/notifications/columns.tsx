import { ActionButton, StatusTag, type AdminColumn } from './components';
import { CHANNEL_LABEL } from './constants';
import { fmtTime } from './utils';
import type { MessageTemplateItem } from '../../../types/api';

/** 消息模板表列定义：编码 / 通道 / 标题 / 正文 / 状态 / 更新时间 / 操作。 */
export function templateColumns(
  writable: boolean,
  onEdit: (row: MessageTemplateItem) => void,
): Array<AdminColumn<MessageTemplateItem>> {
  return [
    {
      key: 'code',
      title: '编码',
      width: 180,
      render: (row) => <code className="font-mono text-[12px] text-foreground">{row.code}</code>,
    },
    {
      key: 'channel',
      title: '通道',
      width: 100,
      render: (row) => CHANNEL_LABEL[row.channel] ?? row.channel,
    },
    {
      key: 'subject',
      title: '标题',
      width: 180,
      render: (row) => (
        <span className="block max-w-[180px] truncate" title={row.subject ?? undefined}>
          {row.subject || '—'}
        </span>
      ),
    },
    {
      key: 'body',
      title: '正文',
      render: (row) => (
        <span className="block max-w-[420px] truncate text-muted-foreground" title={row.body}>
          {row.body}
        </span>
      ),
    },
    {
      key: 'enabled',
      title: '状态',
      width: 90,
      render: (row) => (
        <StatusTag status={row.enabled ? 'active' : 'disabled'} label={row.enabled ? '启用' : '停用'} />
      ),
    },
    { key: 'updatedAt', title: '更新时间', width: 170, render: (row) => fmtTime(row.updatedAt) },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <ActionButton variant="ghost" size="sm" onClick={() => onEdit(row)}>
            编辑
          </ActionButton>
        ) : null,
    },
  ];
}
