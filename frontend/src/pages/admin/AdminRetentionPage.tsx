import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminRetentionApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Notice } from '../../admin-ui/primitives';
import { NumberInput, TextInput } from '../../admin-ui/controls';
import {
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { PageHeader, Panel, StatCard, StatusTag } from '../../components/admin/PageHeader';
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
  ApiCallLog: '模型调用记录',
  BackupRecord: '备份记录',
  CleanupLog: '清理日志',
};

export function AdminRetentionPage() {
  const toast = useToast();
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
  const [daysBase, setDaysBase] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<AdminRetentionTarget | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * 草稿依赖 data 而不是 targets: targets 是 `data?.[0] ?? []`, 每次渲染都是新数组,
   * 拿它当依赖会 setDays → 重渲染 → setDays 无限循环。
   */
  useEffect(() => {
    if (!data) return;
    const next = Object.fromEntries(data[0].map((x) => [x.table, x.retentionDays]));
    setDays(next);
    setDaysBase(next);
  }, [data]);

  const dirtyCount = targets.filter(
    (t) => (days[t.table] ?? t.retentionDays) !== (daysBase[t.table] ?? t.retentionDays),
  ).length;
  useUnsavedGuard(writable && dirtyCount > 0);

  const openCleanup = (t: AdminRetentionTarget) => {
    setReason('');
    setPending(t);
  };

  const runCleanup = async () => {
    if (!pending) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写清理原因，它会写入操作审计');
      return;
    }
    const keep = days[pending.table] ?? pending.retentionDays;
    setBusy(true);
    try {
      const r = await adminRetentionApi.cleanup(pending.table, keep, trimmed);
      toast.success(`已清理 ${r.deleted} 条（保留 ${keep} 天）`);
      setPending(null);
      void reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清理失败');
    } finally {
      setBusy(false);
    }
  };

  const totalRows = targets.reduce((s, t) => s + t.total, 0);
  const totalExpiring = targets.reduce((s, t) => s + t.expiring, 0);

  const targetColumns: Array<AdminColumn<AdminRetentionTarget>> = [
    {
      key: 'target',
      title: '清理目标',
      width: 220,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.label}</span>
          <code className="font-mono text-[11px] text-text-tertiary">{row.table}</code>
        </div>
      ),
    },
    {
      key: 'note',
      title: '说明',
      render: (row) => <span className="text-[11px] text-text-tertiary">{row.note}</span>,
    },
    {
      key: 'total',
      title: '当前条数',
      width: 100,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.total}</span>,
    },
    {
      key: 'days',
      title: '保留天数',
      width: 120,
      render: (row) => (
        <NumberInput
          ariaLabel={`${row.label}保留天数`}
          className="w-[90px]"
          value={days[row.table] ?? row.retentionDays}
          disabled={!writable}
          onChange={(value) => setDays((d) => ({ ...d, [row.table]: value ?? 0 }))}
        />
      ),
    },
    {
      key: 'expiring',
      title: '预计删除',
      width: 150,
      render: (row) => {
        const keep = days[row.table] ?? row.retentionDays;
        // 改了天数后, 原预估就失效了 —— 必须显式说明而不是继续显示旧数字
        const dirty = keep !== row.retentionDays;
        return (
          <div className="flex flex-col gap-0.5">
            <span
              className={
                row.expiring > 0 ? 'tabular-nums font-medium text-rose-600' : 'tabular-nums'
              }
            >
              {row.expiring} 条
            </span>
            {dirty && (
              <span className="text-[11px] text-text-tertiary">按 {row.retentionDays} 天估算，已改动</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'oldestAt',
      title: '最早记录',
      width: 170,
      render: (row) => <span className="text-[11px] text-text-tertiary">{fmtTime(row.oldestAt)}</span>,
    },
    {
      key: 'ops',
      title: '',
      width: 90,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <Button variant="ghost" size="small" onClick={() => openCleanup(row)}>
            清理
          </Button>
        ) : null,
    },
  ];

  const logColumns: Array<AdminColumn<AdminCleanupLog>> = [
    {
      key: 'createdAt',
      title: '时间',
      width: 170,
      render: (row) => fmtTime(row.createdAt),
    },
    {
      key: 'target',
      title: '目标',
      width: 150,
      render: (row) => (
        <span className="text-[11px] text-text-tertiary">{TARGET_LABELS[row.target] ?? row.target}</span>
      ),
    },
    {
      key: 'retentionDays',
      title: '保留天数',
      width: 100,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.retentionDays}</span>,
    },
    {
      key: 'deletedCount',
      title: '删除条数',
      width: 100,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.deletedCount}</span>,
    },
    { key: 'trigger', title: '触发', width: 90, render: (row) => (row.trigger === 'manual' ? '手动' : '定时') },
    {
      key: 'success',
      title: '结果',
      width: 100,
      render: (row) => <StatusTag status={row.success ? 'succeeded' : 'failed'} />,
    },
    {
      key: 'msg',
      title: '说明',
      render: (row) => (
        <span className="text-[11px] text-text-tertiary">{row.errorMessage ?? '—'}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="保留期清理"
        description="按时间清理运行痕迹类数据。订单、积分流水、素材与任务不在可清理范围内。"
      />

      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(3,minmax(0,1fr))]">
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
        extra={
          writable && dirtyCount > 0 ? (
            <Button variant="ghost" size="small" onClick={() => setDays({ ...daysBase })}>
              放弃 {dirtyCount} 项改动
            </Button>
          ) : undefined
        }
      >
        {/* 失败态交给 AdminDataTable 统一渲染: 「没有可清理目标」是空态语义,
            不能把「没连上」显示成「没有目标」 */}
        <AdminDataTable<AdminRetentionTarget>
          rows={targets}
          columns={targetColumns}
          rowKey={(row) => row.table}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          minWidth={1100}
          emptyText="没有可清理的目标"
        />
      </Panel>

      <Panel title="清理记录" note="最近 50 条；失败记录同样留痕">
        <AdminDataTable<AdminCleanupLog>
          rows={logs}
          columns={logColumns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          minWidth={1000}
          emptyText="还没有清理记录"
        />
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
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-text-secondary">清理原因（强制，写入审计）：</label>
              <TextInput
                ariaLabel="清理原因"
                value={reason}
                onChange={setReason}
                placeholder="如：季度合规清理"
                maxLength={200}
              />
            </div>
          }
        />
      )}

      <Notice
        tone="warn"
        icon={<ShieldAlert className="size-4 shrink-0" aria-hidden />}
        className="mb-0"
      >
        删除前请确认已做过备份：清理不进入回收站，SQLite 的 VACUUM 之后也无法从文件碎片恢复。
      </Notice>
    </>
  );
}
