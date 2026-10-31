import { useState } from 'react';
import { DatabaseBackup, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminBackupsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import {
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel, StatCard, StatusTag } from '../../components/admin/PageHeader';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Descriptions, FormField, Notice } from '../../admin-ui/primitives';
import { NumberInput, TextInput } from '../../admin-ui/controls';
import type { AdminBackup } from '../../types/api';

/** 字节数 → 人类可读 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 相对时间 */
function formatRelative(iso: string | null): string {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * 数据备份。
 *
 * ## 三条硬约束
 *
 * 1. **未验证的备份不可下载**（B-97）。下载入口只在 `row.verified` 时出现，
 *    未验证的显示为置灰文字并说明原因，而不是给一个点了报错的按钮。
 * 2. **手动备份必须填原因**。`backup.run` 属高危权限，审计要能回答
 *    「这次备份是谁为什么做的」。
 * 3. **删除单份备份直接执行**，按产品要求不再弹二次确认（确认条只留给
 *    「保留份数清理」这种批量不可逆操作）。
 */
export function AdminBackupPage() {
  const toast = useToast();
  const { can } = useAdmin();

  const [busy, setBusy] = useState(false);

  const [pruneOpen, setPruneOpen] = useState(false);
  const [keepCount, setKeepCount] = useState(7);
  const [runOpen, setRunOpen] = useState(false);
  const [runReason, setRunReason] = useState('');
  const [runReasonError, setRunReasonError] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  /*
   * 三个请求本来就绑定在同一份「备份现状」上, 拆开只会让页面出现
   * 「统计有了但列表还空」的中间态。用一个 fetcher 一起拉, 一起成功或失败。
   */
  const { data, loading, error, reload } = useAdminResource(async () => {
    const [rows, stats, logs] = await Promise.all([
      adminBackupsApi.list(),
      adminBackupsApi.stats(),
      adminBackupsApi.cleanupLogs(10),
    ]);
    return { rows, stats, logs };
  });
  const rows = data?.rows ?? [];
  const stats = data?.stats ?? null;
  const logs = data?.logs ?? [];

  /*
   * 手动备份仍然要求填写原因（审计需要回答「谁为什么做」），但按产品要求
   * 原因放在页面内操作条里，不再用弹窗；填完点「开始备份」直接执行。
   */
  const runBackup = async () => {
    const trimmed = runReason.trim();
    if (!trimmed) {
      setRunReasonError(true);
      return;
    }
    setBusy(true);
    try {
      const rec = await adminBackupsApi.run(`manual-${Date.now()}`, trimmed);
      toast.success(`备份完成: ${rec.filename}`);
      setRunOpen(false);
      setRunReason('');
      setRunReasonError(false);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (row: AdminBackup) => {
    setBusy(true);
    try {
      const rec = await adminBackupsApi.verify(row.id);
      if (rec.verified) {
        toast.success(`验证通过 — ${rec.verifyReport ?? ''}`);
      } else {
        toast.error('验证未通过, 详见详情');
      }
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (row: AdminBackup) => {
    try {
      await adminBackupsApi.download(row.id, row.filename);
      toast.success('已开始下载');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /** 删除单份备份按产品要求直接执行，不再弹窗二次确认 */
  const doDelete = async (row: AdminBackup) => {
    setBusy(true);
    try {
      await adminBackupsApi.remove(row.id);
      toast.success('已删除');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPrune = async () => {
    setBusy(true);
    try {
      const res = await adminBackupsApi.prune(keepCount);
      setPruneOpen(false);
      toast.success(`已清理 ${res.removed} 份, 释放 ${formatBytes(res.freedBytes)}`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminBackup>> = [
    {
      key: 'filename',
      title: '文件名',
      width: 230,
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <code className="font-mono text-xs text-text-primary">{row.filename}</code>
          <span className="text-[11px] text-text-tertiary">{formatBytes(row.sizeBytes)}</span>
        </div>
      ),
    },
    {
      key: 'trigger',
      title: '触发',
      width: 80,
      render: (row) => (
        <span className="text-xs text-text-secondary">
          {row.trigger === 'manual' ? '手动' : '自动'}
        </span>
      ),
    },
    {
      key: 'status',
      title: '备份状态',
      width: 90,
      render: (row) => (
        <StatusTag
          status={row.status}
          label={row.status === 'succeeded' ? '成功' : row.status === 'failed' ? '失败' : '进行中'}
        />
      ),
    },
    {
      key: 'verified',
      title: '恢复验证',
      width: 110,
      render: (row) => {
        if (row.status !== 'succeeded') {
          return <span className="text-[11px] text-text-tertiary">—</span>;
        }
        return row.verified ? (
          <StatusTag status="verified" label="已验证" tone="success" />
        ) : (
          <StatusTag status="unverified" label="未验证" tone="warn" />
        );
      },
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 110,
      render: (row) => (
        <span
          className="text-xs text-text-secondary"
          title={new Date(row.createdAt).toLocaleString('zh-CN')}
        >
          {formatRelative(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '',
      width: 230,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          {/*
           * 行内详情（SHA-256 / 验证报告）必须可达：B-97 的举证就在这一层。
           * antd 表格自带展开图标，换表后没有了，这里补回显式入口。
           */}
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              setExpanded((keys) =>
                keys.includes(row.id) ? keys.filter((key) => key !== row.id) : [row.id],
              )
            }
          >
            {expanded.includes(row.id) ? '收起' : '详情'}
          </Button>
          {can('backup.run') && row.status === 'succeeded' && (
            <Button variant="ghost" size="xs" onClick={() => void verify(row)} disabled={busy}>
              验证
            </Button>
          )}
          {row.verified ? (
            <Button variant="ghost" size="xs" onClick={() => void download(row)}>
              下载
            </Button>
          ) : (
            /* B-97: 无验证记录的备份视为无效, 不给下载入口 */
            <span
              className="cursor-not-allowed text-[11px] text-text-placeholder"
              title="未通过恢复验证的备份不可下载"
            >
              下载
            </span>
          )}
          {can('backup.run') && (
            <Button
              variant="dangerGhost"
              size="xs"
              onClick={() => void doDelete(row)}
              disabled={busy}
            >
              删除
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (loading && !data) return <AdminListLoading tip="加载备份记录…" />;
  if (error && !data) return <AdminListError error={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader
        title="数据备份"
        description="数据库定期全量备份 · 每份备份须通过恢复验证后才可下载"
        actions={
          can('backup.run') ? (
            <>
              <Button
                variant="secondary"
                size="small"
                leadingIcon={Trash2}
                onClick={() => setPruneOpen(true)}
                disabled={busy || rows.length === 0}
              >
                保留份数清理
              </Button>
              <Button
                variant="primary"
                size="small"
                leadingIcon={DatabaseBackup}
                onClick={() => {
                  setRunReason('');
                  setRunReasonError(false);
                  setRunOpen(true);
                }}
                disabled={busy}
              >
                {busy ? '执行中…' : '立即备份'}
              </Button>
            </>
          ) : undefined
        }
      />

      {/* 备份健康度: 过期或存在未验证备份时给出警示 —— 这两项直接对应"出事时能不能用" */}
      {stats && (stats.stale || stats.unverified > 0 || stats.failed > 0) && (
        <Notice tone="warn" title="备份健康度需要处理" icon={<ShieldAlert className="size-4" aria-hidden />}>
          {stats.stale && <div>超过 24 小时没有成功备份，请检查调度器是否运行。</div>}
          {stats.unverified > 0 && (
            <div>
              有 {stats.unverified} 份备份未经恢复验证，事故时可能无法使用，请尽快验证。
            </div>
          )}
          {stats.failed > 0 && <div>有 {stats.failed} 次备份失败，请在操作审计中查看原因。</div>}
        </Notice>
      )}

      {stats && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="备份份数"
            value={stats.total}
            hint={`成功 ${stats.succeeded} · 失败 ${stats.failed}`}
          />
          <StatCard
            label="已验证"
            value={stats.verified}
            hint="通过恢复验证的份数"
          />
          <StatCard
            label="未验证"
            value={stats.unverified}
            hint="不可下载"
            tone={stats.unverified > 0 ? 'warn' : undefined}
          />
          <StatCard label="占用空间" value={stats.totalMb} hint="MB" />
          <StatCard
            label="最近成功备份"
            value={<span className="text-[18px]">{formatRelative(stats.lastSuccessAt)}</span>}
            hint={
              stats.lastSuccessAt
                ? new Date(stats.lastSuccessAt).toLocaleString('zh-CN')
                : '从未成功备份'
            }
          />
        </div>
      )}

      {/* 刷新失败但手上还有上一次的数据: 备份是出事时才来的页面, 更不能假装数据是新的 */}
      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <Panel title="备份记录" note="未验证的备份视为无效，不可下载">
        {rows.length === 0 ? (
          <AdminEmpty
            description="还没有任何备份记录"
            action={
              can('backup.run') ? (
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => {
                    setRunReason('');
                    setRunReasonError(false);
                    setRunOpen(true);
                  }}
                  disabled={busy}
                >
                  立即执行一次备份
                </Button>
              ) : undefined
            }
          />
        ) : (
          <AdminDataTable<AdminBackup>
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            loading={loading}
            error={error}
            onRetry={() => void reload()}
            minWidth={860}
            density="compact"
            renderExpanded={(row) => (
              <Descriptions
                columns={2}
                items={[
                  {
                    label: 'SHA-256',
                    value: (
                      <code className="break-all font-mono text-[11px]">{row.sha256 || '—'}</code>
                    ),
                  },
                  {
                    label: '源库大小',
                    value:
                      row.sourceSizeBytes !== null ? formatBytes(row.sourceSizeBytes) : '—',
                  },
                  {
                    label: '验证时间',
                    value: row.verifiedAt
                      ? new Date(row.verifiedAt).toLocaleString('zh-CN')
                      : '未验证',
                  },
                  ...(row.verifyReport
                    ? [{ label: '验证报告', value: row.verifyReport }]
                    : []),
                  ...(row.verifyWarnings
                    ? [
                        {
                          label: '验证告警',
                          value: <span className="text-amber-700">{row.verifyWarnings}</span>,
                        },
                      ]
                    : []),
                  ...(row.errorMessage
                    ? [
                        {
                          label: '失败原因',
                          value: <span className="text-rose-600">{row.errorMessage}</span>,
                        },
                      ]
                    : []),
                ]}
              />
            )}
            expandedKeys={expanded}
            onExpandedChange={setExpanded}
          />
        )}
      </Panel>

      <Panel title="清理留痕" note="到期数据清理是不可逆操作，全部留痕">
        {logs.length === 0 ? (
          <AdminEmpty description="暂无清理记录" />
        ) : (
          <ul className="flex flex-col divide-y divide-border-table">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <StatusTag
                  status={log.success ? 'succeeded' : 'failed'}
                  label={log.success ? '成功' : '失败'}
                  tone={log.success ? 'success' : 'danger'}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{log.target}</span>
                <span className="shrink-0 text-[11px] text-text-tertiary">
                  删除 {log.deletedCount} 条 · 保留 {log.retentionDays} 天 ·{' '}
                  {log.trigger === 'manual' ? '手动' : '自动'}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
                  {new Date(log.createdAt).toLocaleString('zh-CN')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {runOpen && (
        <ConfirmAction
          open
          title="立即备份"
          confirmText="开始备份"
          loading={busy}
          onCancel={() => {
            setRunOpen(false);
            setRunReason('');
            setRunReasonError(false);
          }}
          onConfirm={() => void runBackup()}
          description={
            <p>
              将对当前数据库做一次全量快照，保存到服务器的备份目录。
              备份期间会短暂持有数据库写锁，其他写操作会排队等待。
            </p>
          }
          impact={[
            stats ? `当前已备份 ${stats.total} 份，占用 ${stats.totalMb} MB` : '将在备份完成后重新统计占用',
            '新备份初始状态为「未验证」，需再做一次恢复验证才能下载',
            '本次操作原因会写入操作审计',
          ]}
          extra={
            <FormField
              label="备份原因（强制，写入审计）："
              htmlFor="adm-backup-reason"
              required
              error={
                runReasonError
                  ? '请先填写原因，否则审计里无法回答「这次备份是谁为什么做的」。'
                  : null
              }
            >
              <TextInput
                value={runReason}
                onChange={(next) => {
                  setRunReason(next);
                  if (next.trim()) setRunReasonError(false);
                }}
                placeholder="如：本周例行备份 / 改动结构前留档"
                maxLength={200}
                ariaLabel="备份原因"
              />
            </FormField>
          }
        />
      )}

      {pruneOpen && (
        <ConfirmAction
          open
          title="保留份数清理"
          confirmText="执行清理"
          danger
          loading={busy}
          onCancel={() => setPruneOpen(false)}
          onConfirm={() => void doPrune()}
          description={<p>超出保留份数的旧备份将被自动删除（仅删除已验证的备份）。</p>}
          extra={
            <FormField label="保留份数" htmlFor="adm-keep">
              <NumberInput
                value={keepCount}
                min={1}
                max={100}
                onChange={(next) => setKeepCount(next ?? 7)}
                ariaLabel="保留份数"
                className="w-28"
              />
            </FormField>
          }
          impact={[
            `当前共 ${rows.length} 份备份`,
            `将保留最新 ${keepCount} 份已验证备份`,
            '失败与未验证的备份不在清理范围内',
          ]}
        />
      )}
    </>
  );
}
