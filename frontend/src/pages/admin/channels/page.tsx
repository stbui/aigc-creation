import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  AdminPage,
  ActionButton,
  Button,
  StaleError,
  ConfirmDialog,
  Panel,
  SegmentedGroup,
  SkeletonBody,
} from '~/admin-ui/primitives';
import { useChannelWorkspace } from './useChannelWorkspace';
import { channelConsumptionRefs, consumptionImpactText } from './useProductConsumption';
import { ChannelDetailPanel } from './ChannelDetailPanel';
import { ChannelListPanel } from './ChannelListPanel';
import { ChannelModelHealthPanel } from './ChannelModelHealthPanel';
import { CHANNEL_VIEW_OPTIONS } from './constants';

/**
 * 模型商品（`/admin/channels`）。
 *
 * 主对象是**模型商品**：运营先看「哪些商品能卖、被谁消费」，再下钻到供应商。
 * 供应商（原渠道）是商品来源：Base URL、凭证、并发、出站代理都在供应商视图
 * 配置，一条供应商可以挂任意模态的商品。
 *
 * 四条不能省的行为：
 *   1. 凭证只写不读 —— 后台投影永不回显 API Key，只显示「已配置」；
 *   2. 删除是软删除（账单 / 调用记录仍引用渠道 id），凭证立即清空；
 *   3. 新建供应商默认启用；商品导入只有在套用默认配置或本次统一配置后
 *      才能直接启用 —— 没有售价的商品进路由只会让用户收到「无可用线路」；
 *   4. 保存任何供应商写入都让目录快照失效，C 端下一次请求即生效。
 *
 * ## 代码边界
 *
 * 默认「商品台账」视图只同步加载商品表与线路健康；供应商主从视图、商品
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
    canReadCapabilities,
    canReadPlugins,
    resetCooling,
    coolingCount,
    resettingHealth,
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
    consumption,
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
    autoUpstreamFor,
    setAutoUpstreamFor,
  } = useChannelWorkspace();

  const healthPanel = (
    <Panel
      title="线路健康"
      extra={
        writable && coolingCount > 0 ? (
          // 冷却只对可归因失败写入；上游恢复后允许提前解除，省掉再等一个冷却周期
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={resettingHealth}
            onClick={() => void resetCooling()}
          >
            {resettingHealth ? '解除中…' : `解除冷却（${coolingCount}）`}
          </ActionButton>
        ) : undefined
      }
    >
      {health.error && health.rows.length === 0 ? (
        <StaleError error={health.error} onRetry={() => void health.reload()} />
      ) : (
        <ChannelModelHealthPanel rows={health.rows} loading={health.loading} />
      )}
    </Panel>
  );

  return (
    <AdminPage
      title="模型商品"
      description="商品来自供应商渠道；能力决定谁在消费这些商品。"
      actions={
        <>
          {writable && (
            <ActionButton
              variant="default"
              size="sm"
              icon={Plus}
              onClick={() => {
                setView('channels');
                openCreate();
              }}
            >
              接入供应商
            </ActionButton>
          )}
          {canReadCapabilities && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/capabilities">能力与模型</Link>
            </Button>
          )}
          {canReadPlugins && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/plugins">插件</Link>
            </Button>
          )}
        </>
      }
    >

      <SegmentedGroup
        ariaLabel="模型商品视图"
        value={view}
        onChange={(value) => setView(value === 'channels' ? 'channels' : 'models')}
        options={CHANNEL_VIEW_OPTIONS}
      />

      {view === 'models' ? (
        <div className="min-w-0">
          {/* 同页还有「线路健康」表格，视觉定位用容器包一层，测试按容器取行 */}
          <div data-testid="admin-all-models">
            <Panel title="商品台账">
              <Suspense fallback={<SkeletonBody rows={8} />}>
                <AllChannelModelsPanel
                  writable={modelWritable}
                  consumption={consumption}
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
          className="grid grid-cols-[272px_minmax(0,1fr)] items-start gap-4"
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
              consumption={consumption}
              autoUpstream={autoUpstreamFor === selected?.id}
              onAutoUpstreamConsumed={() => setAutoUpstreamFor(null)}
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
            ? `停用供应商「${toggleTarget?.name}」？`
            : `启用供应商「${toggleTarget?.name}」？`
        }
        description={
          toggleTarget?.enabled
            ? '停用后新任务不会使用该供应商；配置会保留，可随时重新启用。'
            : '启用后，配置完整的商品会恢复使用。'
        }
        impact={
          toggleTarget?.enabled
            ? [
              `该供应商下的 ${toggleTarget?.modelCosts?.length ?? 0} 个在售商品将暂停使用`,
              ...(toggleTarget
                ? [consumptionImpactText(channelConsumptionRefs(toggleTarget, consumption.byModelKey))]
                : []),
              '消费这些商品的能力可能暂时不可用',
            ]
            : ['只恢复已启用且设置好售价的商品，其余仍不可用']
        }
        danger={Boolean(toggleTarget?.enabled)}
        confirmText={toggleTarget?.enabled ? '确认停用' : '确认启用'}
        loading={saving}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void runToggle()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除供应商「${deleteTarget?.name ?? ''}」？`}
        description="删除后访问凭证立即清除，供应商及其商品将停止使用；账单与调用记录保留。"
        impact={[
          `该供应商下的 ${deleteTarget?.modelCosts?.length ?? 0} 个在售商品一并作废`,
          ...(deleteTarget
            ? [consumptionImpactText(channelConsumptionRefs(deleteTarget, consumption.byModelKey))]
            : []),
          '消费这些商品的能力会不可用，需要重新选择来源',
        ]}
        danger
        confirmText="确认删除"
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
      />
    </AdminPage>
  );
}
