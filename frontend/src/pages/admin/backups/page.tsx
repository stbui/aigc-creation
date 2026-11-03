import { useState } from 'react';
import { DatabaseBackup, Trash2 } from 'lucide-react';
import { adminBackupsApi, adminRetentionApi } from './api';
import {
  ActionButton,
  EmptyState,
  ListError,
  PageHeader,
  PageSkeleton,
  Panel,
  StaleError,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminResource, useToast } from './hooks';
import { DEFAULT_KEEP_COUNT } from './constants';
import { formatBytes } from './utils';
import { BackupHealth } from './BackupHealth';
import { BackupTable } from './BackupTable';
import { BackupCleanupLog } from './BackupCleanupLog';
import { BackupRunConfirm } from './BackupRunConfirm';
import { BackupPruneConfirm } from './BackupPruneConfirm';
import type { AdminBackup } from '../../../types/api';

/**
 * 数据备份（`/admin/backups`）。
 *
 * ## 三条硬约束
 *
 * 1. **未验证的备份不可下载**（B-97）。下载入口只在 `row.verified` 时出现，
 *    未验证的显示为置灰文字并说明原因，而不是给一个点了报错的按钮。
 * 2. **手动备份写入自动审计原因**。`backup.run` 属高危权限，系统记录
 *    操作人和操作上下文。
 * 3. **删除单份备份直接执行**，按产品要求不再弹二次确认（确认条只留给
 *    「保留份数清理」这种批量不可逆操作）。
 *
 * ## 模块划分
 *
 * 健康度 / 列表 / 清理留痕 / 两个确认条各自独立；本文件只保留取数与写操作编排。
 */
export function AdminBackupPage() {
  const toast = useToast();
  const { can } = useAdmin();

  const [busy, setBusy] = useState(false);

  const [pruneOpen, setPruneOpen] = useState(false);
  const [keepCount, setKeepCount] = useState(DEFAULT_KEEP_COUNT);
  const [runOpen, setRunOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  /*
   * 三个请求本来就绑定在同一份「备份现状」上, 拆开只会让页面出现
   * 「统计有了但列表还空」的中间态。用一个 fetcher 一起拉, 一起成功或失败。
   */
  const { data, loading, error, reload } = useAdminResource(async () => {
    const [rows, stats, logs] = await Promise.all([
      adminBackupsApi.list(),
      adminBackupsApi.stats(),
      adminRetentionApi.logs(10),
    ]);
    return { rows, stats, logs };
  });
  const rows = data?.rows ?? [];
  const stats = data?.stats ?? null;
  const logs = data?.logs ?? [];

  const runBackup = async () => {
    setBusy(true);
    try {
      const rec = await adminBackupsApi.run();
      toast.success(`备份完成: ${rec.filename}`);
      setRunOpen(false);
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

  /*
   * 页头照常渲染：加载期间标题与动作区就该在位。
   * 骨架与真实版面同构：5 张统计卡 + 列表与留痕两块面板。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="数据备份"
        description="数据库定期全量备份 · 每份备份须通过恢复验证后才可下载"
        stats={5}
        panels={2}
        panelRows={5}
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader
        title="数据备份"
        description="数据库定期全量备份 · 每份备份须通过恢复验证后才可下载"
        actions={
          can('backup.run') ? (
            <>
              <ActionButton
                variant="secondary"
                size="sm"
                icon={Trash2}
                onClick={() => setPruneOpen(true)}
                disabled={busy || rows.length === 0}
              >
                保留份数清理
              </ActionButton>
              <ActionButton
                variant="default"
                size="sm"
                icon={DatabaseBackup}
                onClick={() => setRunOpen(true)}
                disabled={busy}
              >
                {busy ? '执行中…' : '立即备份'}
              </ActionButton>
            </>
          ) : undefined
        }
      />

      <BackupHealth stats={stats} />

      {/* 刷新失败但手上还有上一次的数据: 备份是出事时才来的页面, 更不能假装数据是新的 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <Panel title="备份记录" note="未验证的备份视为无效，不可下载">
        {rows.length === 0 ? (
          <EmptyState
            title="还没有任何备份记录"
            description="备份是恢复能力的前提；先执行一次手动备份，再开启定时备份。"
            action={
              can('backup.run') ? (
                <ActionButton
                  variant="default"
                  size="sm"
                  onClick={() => setRunOpen(true)}
                  disabled={busy}
                >
                  立即执行一次备份
                </ActionButton>
              ) : undefined
            }
          />
        ) : (
          <BackupTable
            rows={rows}
            loading={loading}
            error={error}
            onRetry={() => void reload()}
            expanded={expanded}
            onExpandedChange={setExpanded}
            canRun={can('backup.run')}
            busy={busy}
            onVerify={(row) => void verify(row)}
            onDownload={(row) => void download(row)}
            onDelete={(row) => void doDelete(row)}
          />
        )}
      </Panel>

      <BackupCleanupLog logs={logs} />

      <BackupRunConfirm
        open={runOpen}
        busy={busy}
        stats={stats}
        onCancel={() => setRunOpen(false)}
        onConfirm={() => void runBackup()}
      />

      <BackupPruneConfirm
        open={pruneOpen}
        keepCount={keepCount}
        rowCount={rows.length}
        busy={busy}
        onKeepCountChange={setKeepCount}
        onCancel={() => setPruneOpen(false)}
        onConfirm={() => void doPrune()}
      />
    </>
  );
}
