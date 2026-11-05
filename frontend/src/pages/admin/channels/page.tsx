import { lazy, Suspense } from 'react';
import {
  StaleError,
  ConfirmDialog,
  PageHeader,
  Panel,
  SegmentedGroup,
  SkeletonBody,
} from '~/admin-ui/primitives';
import { useChannelWorkspace } from './useChannelWorkspace';
import { ChannelDetailPanel } from './ChannelDetailPanel';
import { ChannelListPanel } from './ChannelListPanel';
import { ChannelModelHealthPanel } from './ChannelModelHealthPanel';
import { CHANNEL_VIEW_OPTIONS } from './constants';

/**
 * 渠道工作台（`/admin/channels`）。
 *
 * 渠道是**供应侧**的唯一入口：Base URL、凭证、并发、出站代理都在这里配置，
 * 一条渠道可以挂任意模态的模型。与 C 端「前台模型」分开，是为了让运营能
 * 只换供应、不改产品：前台模型的 revision 指向线路，线路再指向渠道模型。
 *
 * 四条不能省的行为：
 *   1. 凭证只写不读 —— 后台投影永不回显 API Key，只显示「已配置」；
 *   2. 删除是软删除（账单 / 调用记录 / 审计仍引用渠道 id），凭证立即清空；
 *   3. 新建渠道默认启用，但模型导入一律默认停用：没有价格档的模型进路由
 *      只会让用户收到「无可用线路」；
 *   4. 保存任何渠道写入都让目录快照失效，C 端下一次请求即生效。
 *
 * ## 代码边界
 *
 * 默认「按渠道」视图只同步加载左列、详情和线路健康；跨渠道模型表、渠道
 * 编辑抽屉与排序弹窗都在第一次打开时才下载各自 chunk。路由本身已按页面
 * 懒加载（见 `admin/routes.ts`），这里拆的是页面内部的低频功能。
 *
 * 状态与写操作集中在 `useChannelWorkspace`，本文件只保留布局编排。
 */

/*
 * React.lazy 只接受默认导出；项目组件统一使用命名导出，因此在边界处做一次
 * 适配。动态模块路径保持静态字符串，Vite 才能稳定生成独立 chunk。
 */
const AllChannelModelsPanel = lazy(() =>
  import('./AllChannelModelsPanel').then((module) => ({
    default: module.AllChannelModelsPanel,
  })),
);
const ChannelFormDrawer = lazy(() =>
  import('./ChannelFormDrawer').then((module) => ({
    default: module.ChannelFormDrawer,
  })),
);
const ChannelOrderDialog = lazy(() =>
  import('./ChannelOrderDialog').then((module) => ({
    default: module.ChannelOrderDialog,
  })),
);

export function AdminChannelsPage() {
  const {
    view,
    setView,
    writable,
    modelWritable,
    canTest,
    rows,
    loading,
    error,
    reload,
    keyword,
    status,
    setKeyword,
    setStatus,
    visible,
    clearFilters,
    hasFilters,
    health,
    selectedId,
    setSelectedId,
    selected,
    openChannel,
    openChannelModel,
    editing,
    draft,
    formOpen,
    formDirty,
    saving,
    updateDraft,
    openCreate,
    openEdit,
    requestCloseForm,
    submit,
    duplicate,
    deleteTarget,
    setDeleteTarget,
    runDelete,
    toggleTarget,
    setToggleTarget,
    runToggle,
    exporting,
    runExport,
    importing,
    importFile,
    setImportFile,
    runImport,
    orderFor,
    setOrderFor,
    orderChannel,
    pendingModelId,
    setPendingModelId,
  } = useChannelWorkspace();

  const healthPanel = (
    <Panel title="线路健康">
      {health.error && health.rows.length === 0 ? (
        <StaleError error={health.error} onRetry={() => void health.reload()} />
      ) : (
        <ChannelModelHealthPanel rows={health.rows} loading={health.loading} />
      )}
    </Panel>
  );

  return (
    <>
      <PageHeader
        title="渠道工作台"
        actions={
          <SegmentedGroup
            ariaLabel="渠道工作台视图"
            value={view}
            onChange={(value) => setView(value === 'models' ? 'models' : 'channels')}
            options={CHANNEL_VIEW_OPTIONS}
          />
        }
      />

      {view === 'models' ? (
        <div className="min-w-0">
          {/* 同页还有「线路健康」表格，视觉定位用容器包一层，测试按容器取行 */}
          <div data-testid="admin-all-models">
            <Panel title="全部模型">
              <Suspense fallback={<SkeletonBody rows={8} />}>
                <AllChannelModelsPanel
                  writable={modelWritable}
                  onChanged={() => void reload()}
                  onOpenChannel={openChannel}
                  onEditModel={openChannelModel}
                />
              </Suspense>
            </Panel>
          </div>
          {healthPanel}
        </div>
      ) : (
        <div
          className="grid grid-cols-[224px_minmax(0,1fr)] items-start gap-4"
          data-testid="admin-channel-workspace"
        >
          {/* 导航在右栏长内容滚动时保持可见；列表自身仍随内容自然撑高，不做嵌套滚动 */}
          <div className="sticky top-0 z-10 min-w-0">
            <ChannelListPanel
              rows={rows}
              visible={visible}
              loading={loading}
              error={error}
              hasFilters={hasFilters}
              keyword={keyword}
              status={status}
              selectedId={selectedId}
              healthByChannel={health.byChannel}
              writable={writable}
              importing={importing}
              exporting={exporting}
              importFile={importFile}
              onKeywordChange={setKeyword}
              onStatusChange={setStatus}
              onClearFilters={clearFilters}
              onSelect={setSelectedId}
              onRetry={() => void reload()}
              onCreate={openCreate}
              onExportAll={() => void runExport()}
              onPickImportFile={(file) => setImportFile(file)}
              onClearImportFile={() => setImportFile(null)}
              onImport={() => void runImport()}
              onReorder={() => setOrderFor('')}
            />
          </div>

          <div className="min-w-0">
            <ChannelDetailPanel
              selected={selected}
              loading={loading}
              error={error}
              hasFilters={hasFilters}
              writable={writable}
              modelWritable={modelWritable}
              canTest={canTest}
              saving={saving}
              exporting={exporting}
              pendingModelId={pendingModelId}
              onEdit={openEdit}
              onDuplicate={(channel) => void duplicate(channel)}
              onExport={(channel) => void runExport(channel)}
              onToggle={setToggleTarget}
              onDelete={(channel) => {
                setDeleteTarget(channel);
              }}
              onCreate={openCreate}
              onChanged={() => void reload()}
              onFocusConsumed={() => setPendingModelId(null)}
            />
            {healthPanel}
          </div>
        </div>
      )}

      {formOpen && (
        <Suspense fallback={null}>
          <ChannelFormDrawer
            open
            editing={editing}
            draft={draft}
            dirty={formDirty}
            saving={saving}
            writable={writable}
            onChange={updateDraft}
            onClose={requestCloseForm}
            onSubmit={() => void submit()}
          />
        </Suspense>
      )}

      {orderFor !== null && (
        <Suspense fallback={null}>
          <ChannelOrderDialog
            open
            channelId={orderFor === '' ? undefined : orderFor}
            channelName={orderChannel?.name}
            onClose={() => setOrderFor(null)}
            onSaved={() => void reload()}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={toggleTarget !== null}
        title={
          toggleTarget?.enabled
            ? `停用渠道「${toggleTarget?.name}」？`
            : `启用渠道「${toggleTarget?.name}」？`
        }
        description={
          toggleTarget?.enabled
            ? '停用后新任务不会使用该渠道；配置会保留，可随时重新启用。'
            : '启用后，配置完整的模型会恢复使用。'
        }
        impact={
          toggleTarget?.enabled
            ? [
                `该渠道下的 ${toggleTarget?.modelCosts?.length ?? 0} 个模型将暂停使用`,
                '使用这些模型的前台服务可能暂时不可用',
              ]
            : ['只恢复已启用且设置好价格的模型，其余仍不可用']
        }
        danger={Boolean(toggleTarget?.enabled)}
        confirmText={toggleTarget?.enabled ? '确认停用' : '确认启用'}
        loading={saving}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void runToggle()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除渠道「${deleteTarget?.name ?? ''}」？`}
        description="删除后访问凭证立即清除，渠道及其模型将停止使用；账单与调用记录保留。"
        impact={[
          `该渠道下的 ${deleteTarget?.modelCosts?.length ?? 0} 个模型一并作废`,
          '使用这些模型的前台服务会不可用，需要重新配置服务来源',
        ]}
        danger
        confirmText="确认删除"
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
      />
    </>
  );
}
