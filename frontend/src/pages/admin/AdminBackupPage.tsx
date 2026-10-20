import { useCallback, useEffect, useState } from 'react';
import { App, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DatabaseBackup, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { adminBackupsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  ConfirmAction,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import type { AdminBackup, AdminBackupStats, AdminCleanupLog } from '../../types/api';

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

  const [rows, setRows] = useState<AdminBackup[]>([]);
  const [stats, setStats] = useState<AdminBackupStats | null>(null);
  const [logs, setLogs] = useState<AdminCleanupLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminBackup | null>(null);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [keepCount, setKeepCount] = useState('7');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, st, lg] = await Promise.all([
        adminBackupsApi.list(),
        adminBackupsApi.stats(),
        adminBackupsApi.cleanupLogs(10),
      ]);
      setRows(list);
      setStats(st);
      setLogs(lg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runBackup = async () => {
    setBusy(true);
    try {
      const rec = await adminBackupsApi.run(`manual-${Date.now()}`);
      void message.success(`备份完成: ${rec.filename}`);
      await load();
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
      await load();
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
      await load();
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
      await load();
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
            <button type="button" className="adm-link" onClick={() => void verify(row)} disabled={busy}>
              验证
            </button>
          )}
          {row.verified ? (
            <button type="button" className="adm-link" onClick={() => void download(row)}>
              下载
            </button>
          ) : (
            /* B-97: 无验证记录的备份视为无效, 不给下载入口 */
            <span className="adm-link is-disabled" title="未通过恢复验证的备份不可下载">
              下载
            </span>
          )}
          {can('backup.run') && (
            <button
              type="button"
              className="adm-link is-danger"
              onClick={() => setDeleteTarget(row)}
              disabled={busy}
            >
              删除
            </button>
          )}
        </div>
      ),
    },
  ];

  if (loading && rows.length === 0 && !stats) return <AdminListLoading tip="加载备份记录…" />;
  if (error) return <AdminListError error={error} onRetry={() => void load()} />;

  return (
    <>
      <PageHeader
        title="数据备份"
        description="数据库定期全量备份 · 每份备份须通过恢复验证后才可下载"
        actions={
          <>
            {can('backup.run') && (
              <>
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => setPruneOpen(true)}
                  disabled={busy || rows.length === 0}
                >
                  <Trash2 size={14} style={{ marginRight: 6 }} />
                  保留份数清理
                </button>
                <button type="button" className="adm-btn is-primary" onClick={() => void runBackup()} disabled={busy}>
                  <DatabaseBackup size={14} style={{ marginRight: 6 }} />
                  {busy ? '执行中…' : '立即备份'}
                </button>
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

      <Panel title="备份记录" note="未验证的备份视为无效，不可下载">
        {rows.length === 0 ? (
          <AdminEmpty
            description="还没有任何备份记录"
            action={
              can('backup.run') ? (
                <button type="button" className="adm-btn is-primary" onClick={() => void runBackup()} disabled={busy}>
                  立即执行一次备份
                </button>
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
              <input
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