import { Modal, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
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
  const rows = summary
    ? [...summary.results].sort((a, b) => Number(a.ok) - Number(b.ok))
    : [];

  const columns: ColumnsType<BatchItemResult<T>> = [
    {
      title: '记录',
      dataIndex: 'id',
      key: 'id',
      width: 220,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: '结果',
      dataIndex: 'ok',
      key: 'ok',
      width: 90,
      render: (ok: boolean) => <StatusTag status={ok ? 'success' : 'failed'} label={ok ? '成功' : '失败'} />,
    },
    {
      title: '原因',
      dataIndex: 'message',
      key: 'message',
      render: (v: string | undefined) => <span className="adm-cell-sub">{v ?? '—'}</span>,
    },
  ];

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="知道了"
      cancelButtonProps={{ style: { display: 'none' } }}
      width={720}
    >
      {summary && (
        <>
          <p className="adm-cell-sub" style={{ marginTop: 0 }}>
            共 {summary.total} 条 · 成功 {summary.succeeded} 条
            {summary.failed > 0 ? ` · 失败 ${summary.failed} 条（已按原因排在前面）` : ''}
          </p>
          <Table<BatchItemResult<T>>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
            scroll={{ y: 360 }}
          />
        </>
      )}
    </Modal>
  );
}
