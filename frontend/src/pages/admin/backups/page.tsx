import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DatabaseBackup, Trash2 } from 'lucide-react';
import { adminBackupsApi, adminRetentionApi } from './api';
import {
  AdminPage,
  ActionButton,
  EmptyState,
  FilterActions,
  FilterBar,
  ListError,
  PageSkeleton,
  Panel,
  SelectField,
  StaleError,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminResource, useAdminUrlFilterSync, useToast } from './hooks';
import {
  BACKUP_FILTER_LABELS,
  BACKUP_FILTER_OPTIONS,
  BACKUP_FILTER_PREDICATES,
  DEFAULT_KEEP_COUNT,
} from './constants';
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
 * 2. **手动备份保留备份记录**。`backup.run` 属高危权限，执行结果进入备份列表。
 * 3. **删除单份备份直接执行**，按产品要求不再弹二次确认（确认弹窗只留给
 *    「保留份数清理」这种批量不可逆操作）。
 *
 * ## 模块划分
 *
 * 健康度 / 列表 / 清理留痕 / 两个确认弹窗各自独立；本文件只保留取数与写操作编排。
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
   * 列表筛选。告警中心的四条备份告警都深链到 `?filter=` 某一类：
   * 「最近一次备份失败」落到失败的那几行，「有备份尚未验证」落到未验证的
   * 那几行 —— 否则点告警只是被丢到一个混着全部记录的列表里自己翻。
   *
   * 初值从地址栏取（深链进来的那一类），写回也用同一个键，两边同源。
   */
  const [searchParams] = useSearchParams();
  const urlFilter = searchParams.get('filter');
  const [filter, setFilter] = useState<string | undefined>(() => {
    const value = searchParams.get('filter');
    return value && value in BACKUP_FILTER_PREDICATES ? value : undefined;
  });

  /*
   * 已在本页时也要响应地址栏变化：从告警中心点进「备份失败」时可能只换了
   * query（`?filter=failed`），页面不重挂载，筛选态必须跟着 URL 走。
   */
  useEffect(() => {
    const next = urlFilter && urlFilter in BACKUP_FILTER_PREDICATES ? urlFilter : undefined;
    setFilter((prev) => (prev === next ? prev : next));
  }, [urlFilter]);

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

  /*
   * 筛选写回地址栏：告警中心深链进来时地址栏已经有 `?filter=`，回显与
   * 筛选态必须同源，否则「深链带着筛选来、页面却显示全部」会被当成
   * 深链失效。初始值从地址栏取，写回用同一个键。
   */
  useAdminUrlFilterSync({ filter });

  /* 筛选在客户端做：备份记录量级很小（保留份数个位数到几十），不必多打一次接口 */
  const filteredRows = useMemo(() => {
    if (!filter) return rows;
    const predicate = BACKUP_FILTER_PREDICATES[filter];
    return predicate ? rows.filter(predicate) : rows;
  }, [rows, filter]);

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
    <AdminPage
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
    >

      <BackupHealth stats={stats} />

      {/* 刷新失败但手上还有上一次的数据: 备份是出事时才来的页面, 更不能假装数据是新的 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <Panel title="备份记录" note="未验证的备份视为无效，不可下载">
        <FilterBar>
          <SelectField
            ariaLabel="备份筛选"
            value={filter}
            onChange={(value) => setFilter(value)}
            allowClear
            clearLabel="全部记录"
            options={BACKUP_FILTER_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <FilterActions>
            {filter && (
              <ActionButton variant="secondary" size="sm" onClick={() => setFilter(undefined)}>
                清除筛选
              </ActionButton>
            )}
          </FilterActions>
        </FilterBar>
        {filteredRows.length === 0 ? (
          <EmptyState
            title={
              filter
                ? `没有${BACKUP_FILTER_LABELS[filter] ?? ''}的备份记录`
                : '还没有任何备份记录'
            }
            description={
              filter
                ? '清除筛选可查看全部备份记录。'
                : '备份是恢复能力的前提；先执行一次手动备份，再开启定时备份。'
            }
            action={
              filter ? (
                <ActionButton variant="secondary" size="sm" onClick={() => setFilter(undefined)}>
                  清除筛选
                </ActionButton>
              ) : can('backup.run') ? (
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
            rows={filteredRows}
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
    </AdminPage>
  );
}
