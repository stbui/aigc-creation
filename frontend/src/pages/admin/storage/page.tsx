import {
  AdminPage,
  EmptyState,
  ListError,
  PageSkeleton,
  RefreshButton,
  SkeletonCards,
  SkeletonPanel,
  SkeletonStats,
  StaleError,
} from './components';
import { useAdmin } from './hooks';
import { StorageBackendList } from './StorageBackendList';
import { StorageCapacitySection } from './StorageCapacitySection';
import { StorageConfigDrawer } from './StorageConfigDrawer';
import { StorageCredentialNotice } from './StorageCredentialNotice';
import { useStorageActions } from './useStorageActions';
import { useStorageOverview } from './useStorageOverview';

/**
 * 存储后端配置 (B-62/B-63)。
 *
 * 2026-11 起凭据改为页面可编辑、加密落库（见 docs/non-upstream-extensions.md）：
 * 卡片支持「编辑配置」抽屉，展示脱敏值 + 连通性 + 切换默认后端。明文密钥不回传。
 *
 * 容量统计复用素材域 `GET /admin/assets/stats`（后台唯一的容量事实源），
 * 不在存储域另写一份聚合 —— 两处 groupBy 迟早和素材管理页的数字对不上。
 *
 * 页面只负责组合守卫与各板块：取数落 `useStorageOverview`，探测 / 切换落
 * `useStorageActions`，展示细节由 `StorageXxx` 组件承载。
 */
export function AdminStoragePage() {
  const { can } = useAdmin();
  const { data, loading, error, reload } = useStorageOverview(can('asset.read'));
  const actions = useStorageActions(reload);

  /*
   * 守卫只在「还没有数据」时替换**正文**。探测/切换后端之后要重拉状态 ——
   * 无条件替换会让用户刚点的后端卡片闪一下消失，看起来像操作失败重载。
   *
   * 页头照常渲染：加载期间标题与「刷新」按钮就该在位，否则首屏先闪一段
   * 没有标题的灰条，再突然冒出完整页面 —— 版面跳两次比跳一次更难接受。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="存储配置"
        description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
        actions={<RefreshButton disabled />}
        notice={<StorageCredentialNotice loading />}
        body={
          <>
            <SkeletonStats className="mt-4" count={4} />
            <SkeletonPanel rows={3} />
            <SkeletonCards count={3} />
          </>
        }
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="暂无存储后端信息" />;

  const { status, stats } = data;

  return (
    <AdminPage
      title="存储配置"
      description="素材文件的存放位置。切换只影响新上传，已写入的素材仍按原后端读取。"
      actions={<RefreshButton loading={loading} onRefresh={reload} />}
    >

      {/*
       * 有数据时的刷新**不塌页面**：卡片留在原位，只是「刷新」按钮禁用。
       * 探测/切换后端之后要重拉状态 —— 无条件替换会让用户刚点的后端卡片闪一下
       * 消失，看起来像操作失败重载。
       */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <StorageCredentialNotice loading={false} credentialSource={status.credentialSource} />

      <StorageCapacitySection stats={stats} active={status.active} />

      <StorageBackendList
        backends={status.backends}
        probing={actions.probing}
        busy={actions.busy}
        canProbe={can('channel.test')}
        canSwitch={can('setting.write')}
        canEdit={status.editable && can('setting.write')}
        onProbe={actions.probe}
        onSwitch={actions.doSwitch}
        onEdit={actions.openEditor}
      />

      {actions.editing && (
        <StorageConfigDrawer
          backend={actions.editing.backend}
          view={actions.editing.view}
          open
          saving={actions.busy}
          testing={actions.testing}
          onClose={actions.closeEditor}
          onSubmit={(values) => void actions.doSave(values)}
          onTest={actions.testDraft}
        />
      )}
    </AdminPage>
  );
}
