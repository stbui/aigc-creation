import { useEffect, useState } from 'react';
import { Button } from '../../admin-ui/shadcn/kit';
import { ModalDialog } from '../../admin-ui/primitives/Dialog';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { StatusTag } from './PageHeader';
import type { BatchItemResult, BatchSummary } from '../../types/api';

/**
 * 批量操作的逐条结果。
 *
 * 为什么不只是一个「成功 N 条」的 toast:
 * 批量操作的失败是常态 —— 选了 50 个账号里 3 个是已注销、选了 20 个任务里
 * 8 个不是失败状态。只报成功数会让运营以为全都成了, 少处理的那几条
 * 只能等用户来投诉才发现。
 *
 * 列表默认**把失败项排在前面**: 成功项是"不需要再看"的信息,
 * 真正需要处理的是失败原因。
 */

/** 一页 20 条：与数据表的分页尺寸选项对齐，避免页大小选择器显示空值 */
const PAGE_SIZE = 20;

export function BatchResultModal<T = unknown>({
  open,
  title,
  summary,
  onClose,
}: {
  open: boolean;
  title: string;
  summary: BatchSummary<T> | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);

  // 每次打开都从第一页看起：上一批失败项的位置与这一批无关
  useEffect(() => {
    if (open) setPage(1);
  }, [open, summary]);

  const rows = summary
    ? [...summary.results].sort((a, b) => Number(a.ok) - Number(b.ok))
    : [];

  const columns: Array<AdminColumn<BatchItemResult<T>>> = [
    {
      key: 'id',
      title: '记录',
      width: 220,
      render: (row) => <code className="font-mono text-xs text-text-secondary">{row.id}</code>,
    },
    {
      key: 'ok',
      title: '结果',
      width: 90,
      render: (row) => (
        <StatusTag status={row.ok ? 'success' : 'failed'} label={row.ok ? '成功' : '失败'} />
      ),
    },
    {
      key: 'message',
      title: '原因',
      render: (row) => <span className="text-[11px] text-text-tertiary">{row.message ?? '—'}</span>,
    },
  ];

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      width={720}
      footer={
        <Button variant="primary" size="small" onClick={onClose}>
          知道了
        </Button>
      }
    >
      {summary && (
        <>
          <p className="mb-3 text-xs text-text-tertiary">
            共 {summary.total} 条 · 成功 {summary.succeeded} 条
            {summary.failed > 0 ? ` · 失败 ${summary.failed} 条（已按原因排在前面）` : ''}
          </p>
          <AdminDataTable<BatchItemResult<T>>
            rows={pageRows}
            columns={columns}
            rowKey={(row) => row.id}
            minWidth={600}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: rows.length,
              onChange: (next) => setPage(next),
            }}
          />
        </>
      )}
    </ModalDialog>
  );
}
