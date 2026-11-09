import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ContextBanner, Notice, PageHeader, SavedViewBar } from '~/admin-ui/primitives';
import { readAdminDone } from '../../../lib/admin-context-link';
import { useAdmin, useAdminDetailParam, useDuty, useSelectionPrune } from './hooks';
import { TaskActionDialogs } from './TaskActionDialogs';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TaskFailureGroups } from './TaskFailureGroups';
import { TaskFilters } from './TaskFilters';
import { TaskListSection } from './TaskListSection';
import { TaskStats } from './TaskStats';
import { useTaskActions } from './useTaskActions';
import { useTaskFilters } from './useTaskFilters';
import { useTaskTableColumns } from './TaskTableColumns';

/**
 * 任务监控 (admin-prd.md B-28~B-33)。
 *
 * 页面只做编排：筛选生命周期、表格列、列表工具栏与写操作分别由独立模块
 * 承载。批量动作不按状态预筛勾选，后端逐条返回结果，避免前端静默丢行。
 */
export function AdminTasksPage() {
  const { can } = useAdmin();
  const [selected, setSelected] = useState<string[]>([]);
  const clearSelection = useCallback(() => setSelected([]), []);
  const filters = useTaskFilters({ onQueryChange: clearSelection });
  const [detailId, setDetailId] = useAdminDetailParam();
  const closeDetail = useCallback(() => setDetailId(null), [setDetailId]);
  const openDetail = useCallback((id: string) => setDetailId(id), [setDetailId]);

  const actions = useTaskActions({
    reload: filters.reload,
    onDeleted: closeDetail,
    selected,
    onSelectionChange: setSelected,
  });

  const columns = useTaskTableColumns({
    can,
    onOpenDetail: openDetail,
    onAction: actions.openConfirm,
  });

  const [searchParams] = useSearchParams();
  const done = readAdminDone(searchParams);
  const { data: duty } = useDuty();
  const list = filters.data?.result;
  /* 换筛选与翻页都会清空勾选；再按当前页裁剪一次，兜住页大小与排序变化 */
  const visibleTaskIds = useMemo(() => (list?.items ?? []).map((row) => row.id), [list]);
  useSelectionPrune(setSelected, visibleTaskIds);
  const liveCongestion = duty?.congestion ?? filters.data?.congestion;
  const overloaded = (liveCongestion?.running ?? 0) > (liveCongestion?.runningThreshold ?? 50);

  return (
    <>
      <PageHeader title="任务监控" />

      {(done === 'billing_settled' || done === 'billing_refunded') && (
        <ContextBanner
          title={done === 'billing_refunded' ? '关联账单已退款' : '关联账单已结算'}
          detail="账单终态已更新；如需重试，请重新发起并确认扣费影响。"
        />
      )}

      <TaskStats
        total={list?.total ?? null}
        congestion={liveCongestion ?? null}
        hasFilter={filters.hasFilter}
        loading={filters.loading}
      />

      <TaskFailureGroups
        groups={filters.data?.failureGroups ?? []}
        activeErrorCode={filters.errorCode || undefined}
        onSelect={(errorCode) => {
          clearSelection();
          filters.setStatus('failed');
          filters.setErrorCode(errorCode);
          filters.setQuery({ status: 'failed', errorCode });
        }}
        onClear={() => {
          filters.setErrorCode('');
          filters.setQuery({ errorCode: undefined });
        }}
      />

      {/* 超阈值只在真的超了才出现：常亮的阈值提示会变成装饰。 */}
      {overloaded && (
        <Notice
          tone="warn"
          title={`执行中 ${liveCongestion?.running} 已超阈值 ${liveCongestion?.runningThreshold}`}
        >
          通道可能跟不上提交速度，先看概览页的线路状态与冷却通道。
        </Notice>
      )}

      <TaskFilters
        status={filters.status}
        onStatusChange={filters.setStatus}
        capability={filters.capability}
        onCapabilityChange={filters.setCapability}
        owner={filters.owner}
        onOwnerChange={filters.setOwner}
        project={filters.project}
        onProjectChange={filters.setProject}
        errorCode={filters.errorCode}
        onErrorCodeChange={filters.setErrorCode}
        from={filters.from}
        onFromChange={filters.setFrom}
        to={filters.to}
        onToChange={filters.setTo}
        capabilityOptions={filters.capOptions}
        appliedChips={filters.appliedChips}
        onApply={filters.applyFilters}
        onReset={filters.resetFilters}
      />

      <SavedViewBar
        pageKey="tasks"
        currentFilters={{
          status: filters.status,
          capability: filters.capability,
          userId: filters.owner || undefined,
          projectId: filters.project || undefined,
          errorCode: filters.errorCode || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        }}
        onApply={(next) => {
          filters.setStatus(next.status);
          filters.setCapability(next.capability);
          filters.setOwner(next.userId ?? '');
          filters.setProject(next.projectId ?? '');
          filters.setErrorCode(next.errorCode ?? '');
          filters.setFrom(next.from ?? '');
          filters.setTo(next.to ?? '');
          filters.setQuery({
            status: next.status,
            capability: next.capability,
            userId: next.userId,
            projectId: next.projectId,
            errorCode: next.errorCode,
            from: next.from,
            to: next.to,
          });
        }}
      />

      <TaskListSection
        data={filters.data}
        columns={columns}
        loading={filters.loading}
        error={filters.error}
        hasFilter={filters.hasFilter}
        sort={filters.sort}
        selected={selected}
        busy={actions.busy}
        exporting={filters.exporting}
        canRetry={can('task.retry')}
        canCancel={can('task.cancel')}
        canDelete={can('task.delete')}
        canExport={can('data.export')}
        onSelectedChange={setSelected}
        onBatchAction={actions.openBatch}
        onSortChange={(sort) => filters.setQuery({ sort: sort ?? 'createdAt:desc' }, false)}
        onRetry={filters.reload}
        onResetFilters={filters.resetFilters}
        onOpenDetail={openDetail}
        onPageChange={(page, pageSize) => {
          clearSelection();
          filters.setPage(page, pageSize);
        }}
        onExport={() => void filters.exportTasks()}
      />

      <TaskDetailDrawer
        detailId={detailId}
        rows={list?.items ?? []}
        canRetry={can('task.retry')}
        canCancel={can('task.cancel')}
        canDelete={can('task.delete')}
        canReadModelCalls={can('model.call_read')}
        canReadBilling={can('billing_order.read')}
        canReadChannels={can('channel.read')}
        onClose={closeDetail}
        onAction={actions.openConfirm}
      />

      <TaskActionDialogs
        confirm={actions.confirm}
        batchKind={actions.batchKind}
        selectedCount={selected.length}
        busy={actions.busy}
        onCloseConfirm={actions.closeConfirm}
        onCloseBatch={actions.closeBatch}
        onConfirm={actions.runConfirm}
        onRunBatch={actions.runBatch}
      />
    </>
  );
}
