import { useEffect, useState } from 'react';
import { App, Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ShieldAlert } from 'lucide-react';
import { adminRetentionApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import {
  AdminEmpty,
  PageHeader,
  Panel,
  StatCard,
  StatusTag,
} from '../../components/admin/PageHeader';
import type { AdminCleanupLog, AdminRetentionTarget } from '../../types/api';

/**
 * 保留期清理 (B-96)。
 *
 * ## 为什么只给这几个目标
 *
 * 可清理的只有**运行痕迹**: 审计、模型调用记录、备份记录、清理日志。
 * 订单、积分流水、素材、任务一律不在此列 —— 《电子商务法》要求交易信息
 * 保存三年, 且它们是对账的唯一凭据。删了不是"省空间", 是让历史无法还原。
 *
 * ## 为什么必须先看「预计删除条数」
 *
 * 只显示「当前 12,345 条」时, 运营把保留期从 180 改成 7 天并点确认, 并不知道
 * 这一次会删掉多少。所以每行都按当前保留天数先 count 一次「将被删除」。
 */

function fmtTime(v: string | null): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—';
}

/** 清理目标的中文名。后端已给 label, 这里只在日志表里兜底 */
const TARGET_LABELS: Record<string, string> = {
  AdminAuditLog: '后台操作审计',
  ModelCallLog: '模型调用记录',
  BackupRecord: '备份记录',
  CleanupLog: '清理日志',
};

export function AdminRetentionPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('backup.run');

  /*
   * 两个请求走同一次资源加载: 目标表与清理日志缺一条就没法解释「这次会删掉什么」,
   * 分开加载会出现「目标已刷新、日志还是旧的」的错位读数。
   */
  const { data, loading, error, reload } = useAdminResource(
    () => Promise.all([adminRetentionApi.targets(), adminRetentionApi.logs(50)]),
    [],
  );
  const targets = data?.[0] ?? [];
  const logs = data?.[1] ?? [];

  /** 每行的保留天数草稿。改动只影响本行, 点「清理」时才提交 */
  const [days, setDays] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<AdminRetentionTarget | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * 草稿依赖 data 而不是 targets: targets 是 `data?.[0] ?? []`, 每次渲染都是新数组,
   * 拿它当依赖会 setDays → 重渲染 → setDays 无限循环。
   */
  useEffect(() => {
    if (!data) return;
    setDays(Object.fromEntries(data[0].map((x) => [x.table, x.retentionDays])));
  }, [data]);

  const openCleanup = (t: AdminRetentionTarget) => {
    setReason('');
    setPending(t);
  };

  const runCleanup = async () => {
    if (!pending) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      void message.warning('请填写清理原因，它会写入操作审计');
      return;
    }
    const keep = days[pending.table] ?? pending.retentionDays;
    setBusy(true);
    try {
      const r = await adminRetentionApi.cleanup(pending.table, keep, trimmed);
      void message.success(`已清理 ${r.deleted} 条（保留 ${keep} 天）`);
      setPending(null);
      void reload({ silent: true });
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '清理失败');
    } finally {
      setBusy(false);
    }
  };

  const totalRows = targets.reduce((s, t) => s + t.total, 0);
  const totalExpiring = targets.reduce((s, t) => s + t.expiring, 0);

  const targetColumns: ColumnsType<AdminRetentionTarget> = [
    {
      title: '清理目标',
      key: 'target',
      width: 220,
      render: (_: unknown, row) => (
        <div className="adm-cell-stack">
          <span>{row.label}</span>
          <code className="adm-cell-sub">{row.table}</code>
        </div>
      ),
    },
    {
      title: '说明',
      dataIndex: 'note',
      key: 'note',
      render: (v: string) => <span className="adm-cell-sub">{v}</span>,
    },
    {
      title: '当前条数',
      dataIndex: 'total',
      key: 'total',
      width: 100,
    },
    {
      title: '保留天数',
      key: 'days',
      width: 120,
      render: (_: unknown, row) => (
        <Input
          value={String(days[row.table] ?? row.retentionDays)}
          disabled={!writable}
          onChange={(e) =>
            setDays((d) => ({ ...d, [row.table]: Number(e.target.value.replace(/\D/g, '')) || 0 }))
          }
          inputMode="numeric"
          style={{ width: 90 }}
        />
      ),
    },
    {
      title: '预计删除',
      key: 'expiring',
      width: 140,
      render: (_: unknown, row) => {
        const keep = days[row.table] ?? row.retentionDays;
        // 改了天数后, 原预估就失效了 —— 必须显式说明而不是继续显示旧数字
        const dirty = keep !== row.retentionDays;
        return (
          <div className="adm-cell-stack">
            <span className={row.expiring > 0 ? 'adm-text-danger' : undefined}>
              {row.expiring} 条
            </span>
            {dirty && <span className="adm-cell-sub">按 {row.retentionDays} 天估算，已改动</span>}
          </div>
        );
      },
    },
    {
      title: '最早记录',
      dataIndex: 'oldestAt',
      key: 'oldestAt',
      width: 170,
      render: (v: string | null) => <span className="adm-cell-sub">{fmtTime(v)}</span>,
    },
    {
      title: '',
      key: 'ops',
      width: 90,
      render: (_: unknown, row) =>
        writable ? (
          <Button type="link" danger className="adm-link is-danger" onClick={() => openCleanup(row)}>
            清理
          </Button>
        ) : null,
    },
  ];

  const logColumns: ColumnsType<AdminCleanupLog> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => fmtTime(v),
    },
    {
      title: '目标',
      key: 'target',
      width: 150,
      render: (_: unknown, r) => (
        <span className="adm-cell-sub">{TARGET_LABELS[r.target] ?? r.target}</span>
      ),
    },
    {
      title: '保留天数',
      dataIndex: 'retentionDays',
      key: 'retentionDays',
      width: 100,
    },
    {
      title: '删除条数',
      dataIndex: 'deletedCount',
      key: 'deletedCount',
      width: 100,
    },
    {
      title: '触发',
      dataIndex: 'trigger',
      key: 'trigger',
      width: 90,
      render: (v: string) => (v === 'manual' ? '手动' : '定时'),
    },
    {
      title: '结果',
      key: 'success',
      width: 100,
      render: (_: unknown, r) => <StatusTag status={r.success ? 'succeeded' : 'failed'} />,
    },
    {
      title: '说明',
      key: 'msg',
      render: (_: unknown, r) => <span className="adm-cell-sub">{r.errorMessage ?? '—'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="保留期清理"
        description="按时间清理运行痕迹类数据。订单、积分流水、素材与任务不在可清理范围内。"
      />

      <div className="adm-stat-grid">
        <StatCard label="可清理目标" value={targets.length} hint="固定白名单，不支持自定义表名" />
        <StatCard label="记录总数" value={loading ? '—' : totalRows} hint="上述目标的合计条数" />
        <StatCard
          label="按当前天数将删除"
          value={loading ? '—' : totalExpiring}
          hint="仅为预估，实际以执行时为准"
          tone={totalExpiring > 0 ? 'warn' : undefined}
        />
      </div>

      {error && data && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <Panel
        title="清理目标"
        note="每次清理都写入清理日志与操作审计"
      >
        {/* 失败态不用 AdminEmpty: 那是「没有数据」的语义, 会把「没连上」说成「没有可清理目标」。
            已有上一次成功数据时只在上方挂 stale 提示, 表格继续可用, 不整块挖空 */}
        {loading && !data ? (
          <AdminListLoading tip="加载清理目标…" />
        ) : error && !data ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : (
          <Table<AdminRetentionTarget>
            rowKey="table"
            size="small"
            loading={loading}
            columns={targetColumns}
            dataSource={targets}
            pagination={false}
            scroll={{ x: 1100 }}
          />
        )}
      </Panel>

      <Panel
        title="清理记录"
        note="最近 50 条；失败记录同样留痕"
      >
        {loading && !data ? (
          <AdminListLoading tip="加载清理记录…" />
        ) : logs.length === 0 ? (
          <AdminEmpty description="还没有清理记录。" />
        ) : (
          <Table<AdminCleanupLog>
            rowKey="id"
            size="small"
            loading={loading}
            columns={logColumns}
            dataSource={logs}
            pagination={false}
            scroll={{ x: 1000 }}
          />
        )}
      </Panel>

      {pending && (
        <ConfirmAction
          open
          title={`清理${pending.label}`}
          confirmText="确认清理"
          danger
          requireTyping
          typingText={pending.table}
          loading={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void runCleanup()}
          description={
            <p>
              将永久删除 <b>{pending.label}</b> 中早于保留天数的记录。
              此操作不可撤销，也无备份可恢复（除非先做过数据备份）。
            </p>
          }
          impact={[
            `保留 ${days[pending.table] ?? pending.retentionDays} 天，之前记录全部删除`,
            `按 ${pending.retentionDays} 天估算将删除 ${pending.expiring} 条`,
            '写入清理日志与操作审计',
          ]}
          extra={
            <div className="adm-confirm-typing">
              <label htmlFor="adm-retention-reason">清理原因（强制，写入审计）：</label>
              <Input
                id="adm-retention-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如：季度合规清理"
                maxLength={200}
                autoComplete="off"
              />
            </div>
          }
        />
      )}

      <div className="adm-panel">
        <div className="adm-confirm-warn">
          <ShieldAlert size={14} />
          <span>
            删除前请确认已做过备份：清理不进入回收站，SQLite 的 VACUUM 之后也无法从文件碎片恢复。
          </span>
        </div>
      </div>
    </>
  );
}
