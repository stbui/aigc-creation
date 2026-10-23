import { useState } from 'react';
import { App, Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DatabaseBackup, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { adminBackupsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminStaleError,
  AdminListLoading,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
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

export function AdminBackupPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();

  const [busy, setBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminBackup | null>(null);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [keepCount, setKeepCount] = useState('7');
  const [runOpen, setRunOpen] = useState(false);
  const [runReason, setRunReason] = useState('');
  const [runReasonError, setRunReasonError] = useState(false);

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
   * 「立即备份」曾是**点一下就执行**的按钮: 高危权限清单里明明列了 backupRun,
   * 界面上却既没有确认也没有原因, 审计里只留一条 reason=null 的记录。
   * 备份会短暂占用写锁并落一份完整库文件, 误点后果不是"撤销一下"能收回的。
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
      void message.success(`备份完成: ${rec.filename}`);
      setRunOpen(false);
      setRunReason('');
      setRunReasonError(false);
      await reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (row: AdminBackup) => {
    setBusy(true);
    try {
      const rec = await adminBackupsApi.verify(row.id);
      if (rec.verified) {
        void message.success(`验证通过 — ${rec.verifyReport ?? ''}`);
      } else {
        void message.error('验证未通过, 详见详情');
      }
      await reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (row: AdminBackup) => {
    try {
      await adminBackupsApi.download(row.id, row.filename);
      void message.success('已开始下载');
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await adminBackupsApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      void message.success('已删除');
      await reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPrune = async () => {
    setBusy(true);
    try {
      const res = await adminBackupsApi.prune(Number(keepCount));
      setPruneOpen(false);
      void message.success(`已清理 ${res.removed} 份, 释放 ${formatBytes(res.freedBytes)}`);
      await reload();
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminBackup> = [
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
      width: 230,
      render: (name: string, row) => (
        <div>
          <code className="adm-mono">{name}</code>
          <div className="adm-cell-sub">{formatBytes(row.sizeBytes)}</div>
        </div>
      ),
    },
    {
      title: '触发',
      dataIndex: 'trigger',
      key: 'trigger',
      width: 80,
      render: (t: string) => (t === 'manual' ? '手动' : '自动'),
    },
    {
      title: '备份状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => (
        <span className={`adm-tag ${s === 'succeeded' ? 'is-success' : s === 'failed' ? 'is-danger' : 'is-warn'}`}>
          <span className="adm-tag-dot" />
          {s === 'succeeded' ? '成功' : s === 'failed' ? '失败' : '进行中'}
        </span>
      ),
    },
    {
      title: '恢复验证',
      key: 'verified',
      width: 110,
      render: (_: unknown, row) => {
        if (row.status !== 'succeeded') return <span className="adm-cell-sub">—</span>;
        return row.verified ? (
          <span className="adm-tag is-success" title={row.verifyReport ?? ''}>
            <span className="adm-tag-dot" />
            已验证
          </span>
        ) : (
          <span className="adm-tag is-warn">
            <span className="adm-tag-dot" />
            未验证
          </span>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (v: string) => (
        <span title={new Date(v).toLocaleString('zh-CN')}>{formatRelative(v)}</span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 180,
      render: (_: unknown, row) => (
        <div className="adm-row-actions">
          {can('backup.run') && row.status === 'succeeded' && (
            <Button type="link" className="adm-link" onClick={() => void verify(row)} disabled={busy}>
              验证
            </Button>
          )}
          {row.verified ? (
            <Button type="link" className="adm-link" onClick={() => void download(row)}>
              下载
            </Button>
          ) : (
            /* B-97: 无验证记录的备份视为无效, 不给下载入口 */
            <span className="adm-link is-disabled" title="未通过恢复验证的备份不可下载">
              下载
            </span>
          )}
          {can('backup.run') && (
            <Button
              type="link" danger
              className="adm-link is-danger"
              onClick={() => setDeleteTarget(row)}
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
          <>
            {can('backup.run') && (
              <>
                <Button
                  type="default"
                  className="adm-btn"
                  onClick={() => setPruneOpen(true)}
                  disabled={busy || rows.length === 0}
                >
                  <Trash2 size={14} style={{ marginRight: 6 }} />
                  保留份数清理
                </Button>
                <Button
                  type="primary"
                  className="adm-btn is-primary"
                  onClick={() => {
                    setRunReason('');
                    setRunReasonError(false);
                    setRunOpen(true);
                  }}
                  disabled={busy}
                >
                  <DatabaseBackup size={14} style={{ marginRight: 6 }} />
                  {busy ? '执行中…' : '立即备份'}
                </Button>
              </>
            )}
          </>
        }
      />

      {/* 备份健康度: 过期或存在未验证备份时给出警示 —— 这两项直接对应"出事时能不能用" */}
      {stats && (stats.stale || stats.unverified > 0 || stats.failed > 0) && (
        <div className="adm-alert">
          <ShieldAlert size={16} />
          <div>
            {stats.stale && <div>超过 24 小时没有成功备份，请检查调度器是否运行。</div>}
            {stats.unverified > 0 && (
              <div>
                有 {stats.unverified} 份备份未经恢复验证，事故时可能无法使用，请尽快验证。
              </div>
            )}
            {stats.failed > 0 && <div>有 {stats.failed} 次备份失败，请在操作审计中查看原因。</div>}
          </div>
        </div>
      )}

      {stats && (
        <div className="adm-stat-grid">
          <div className="adm-stat is-primary">
            <div className="adm-stat-head">
              <span className="adm-stat-label">备份份数</span>
              <DatabaseBackup className="adm-stat-icon" size={16} />
            </div>
            <div className="adm-stat-value">{stats.total}</div>
            <div className="adm-stat-hint">
              成功 {stats.succeeded} · 失败 {stats.failed}
            </div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">已验证</span>
              <ShieldCheck className="adm-stat-icon" size={16} />
            </div>
            <div className="adm-stat-value">{stats.verified}</div>
            <div className="adm-stat-hint">通过恢复验证的份数</div>
          </div>
          <div className={`adm-stat${stats.unverified > 0 ? ' is-warn' : ''}`}>
            <div className="adm-stat-head">
              <span className="adm-stat-label">未验证</span>
            </div>
            <div className="adm-stat-value">{stats.unverified}</div>
            <div className="adm-stat-hint">不可下载</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">占用空间</span>
            </div>
            <div className="adm-stat-value">{stats.totalMb}</div>
            <div className="adm-stat-hint">MB</div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-head">
              <span className="adm-stat-label">最近成功备份</span>
            </div>
            <div className="adm-stat-value" style={{ fontSize: 18 }}>
              {formatRelative(stats.lastSuccessAt)}
            </div>
            <div className="adm-stat-hint">
              {stats.lastSuccessAt
                ? new Date(stats.lastSuccessAt).toLocaleString('zh-CN')
                : '从未成功备份'}
            </div>
          </div>
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
                <Button type="primary" className="adm-btn is-primary" onClick={() => void runBackup()} disabled={busy}>
                  立即执行一次备份
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table<AdminBackup>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            loading={loading}
            pagination={false}
            expandable={{
              expandedRowRender: (row) => (
                <div className="adm-expand">
                  <dl className="adm-desc">
                    <dt>SHA-256</dt>
                    <dd>
                      <code className="adm-mono">{row.sha256 || '—'}</code>
                    </dd>
                    {row.sourceSizeBytes !== null && (
                      <>
                        <dt>源库大小</dt>
                        <dd>{formatBytes(row.sourceSizeBytes)}</dd>
                      </>
                    )}
                    <dt>验证时间</dt>
                    <dd>{row.verifiedAt ? new Date(row.verifiedAt).toLocaleString('zh-CN') : '未验证'}</dd>
                    {row.verifyReport && (
                      <>
                        <dt>验证报告</dt>
                        <dd>{row.verifyReport}</dd>
                      </>
                    )}
                    {row.verifyWarnings && (
                      <>
                        <dt>验证告警</dt>
                        <dd className="adm-text-warn">{row.verifyWarnings}</dd>
                      </>
                    )}
                    {row.errorMessage && (
                      <>
                        <dt>失败原因</dt>
                        <dd className="adm-text-danger">{row.errorMessage}</dd>
                      </>
                    )}
                  </dl>
                </div>
              ),
            }}
          />
        )}
      </Panel>

      <Panel title="清理留痕" note="到期数据清理是不可逆操作，全部留痕">
        {logs.length === 0 ? (
          <AdminEmpty description="暂无清理记录" />
        ) : (
          <ul className="adm-mini-list">
            {logs.map((log) => (
              <li key={log.id} className="adm-mini-item">
                <span
                  className={`adm-tag ${log.success ? 'is-success' : 'is-danger'}`}
                >
                  <span className="adm-tag-dot" />
                  {log.success ? '成功' : '失败'}
                </span>
                <span className="adm-mini-name">{log.target}</span>
                <span className="adm-cell-sub">
                  删除 {log.deletedCount} 条 · 保留 {log.retentionDays} 天 ·{' '}
                  {log.trigger === 'manual' ? '手动' : '自动'}
                </span>
                <span className="adm-mini-time">
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
          onCancel={() => setRunOpen(false)}
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
            <div className="adm-confirm-typing">
              <label htmlFor="adm-backup-reason">备份原因（强制，写入审计）：</label>
              <Input
                id="adm-backup-reason"
                type="text"
                value={runReason}
                onChange={(e) => {
                  setRunReason(e.target.value);
                  if (e.target.value.trim()) setRunReasonError(false);
                }}
                placeholder="如：本周例行备份 / 改动结构前留档"
                maxLength={200}
                autoComplete="off"
                aria-invalid={runReasonError}
              />
              {runReasonError && (
                <span className="adm-text-danger" role="alert">
                  请先填写原因，否则审计里无法回答「这次备份是谁为什么做的」。
                </span>
              )}
            </div>
          }
        />
      )}

      {deleteTarget && (
        <ConfirmAction
          open
          title="删除备份"
          confirmText="确认删除"
          danger
          loading={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void doDelete()}
          description={
            <>
              <p>即将删除备份文件及其记录，删除后不可恢复。</p>
              <code className="adm-mono">{deleteTarget.filename}</code>
            </>
          }
          impact={[
            `文件大小 ${formatBytes(deleteTarget.sizeBytes)} 将被释放`,
            '系统会确保至少保留一份已验证备份，此规则不可关闭',
          ]}
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
            <div className="adm-field">
              <label htmlFor="adm-keep">保留份数</label>
              <Input
                id="adm-keep"
                type="number"
                min={1}
                max={100}
                value={keepCount}
                onChange={(e) => setKeepCount(e.target.value)}
              />
            </div>
          }
          impact={[
            `当前共 ${rows?.length ?? 0} 份备份`,
            `将保留最新 ${keepCount} 份已验证备份`,
            '失败与未验证的备份不在清理范围内',
          ]}
        />
      )}
    </>
  );
}
