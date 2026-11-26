import { useNavigate } from 'react-router-dom';
import {
  AdminPage,
  AdminTabs,
  EmptyState,
  ListError,
  PageSkeleton,
  SkeletonPanel,
  StaleError,
  TabsContent,
  ToneBadge,
} from './components';
import { CONFIG_TAB_META, SETTINGS_TABS } from './constants';
import { useAdmin } from './hooks';
import { SettingsConfigTab } from './SettingsConfigTab';
import { SettingsSaveDialog } from './SettingsSaveDialog';
import { SettingsSecurityTab } from './SettingsSecurityTab';
import type { SettingsTabKey } from './types';
import { isSettingsTabKey, settingGroupPath } from './utils';
import { useSettingsDraft } from './useSettingsDraft';

/**
 * 系统设置。
 *
 * 页面只保留四个真实运营页签：运行与生成、上传限制、备份、安全。
 * 系统信息、邮箱、支付、退款与保留期分别使用独立工作台。页签只能由 AdminLayout
 * 的四个显式路由传入，页面不识别路径参数或查询参数。
 *
 * 页面只做守卫与板块组合：取数、草稿、变更摘要与保存全部落在 `useSettingsDraft`，
 * 各板块由 `SettingsXxx` 组件承载。
 */
export function AdminSettingsPage({ group: activeTab }: { group: SettingsTabKey }) {
  const { can } = useAdmin();
  const editable = can('setting.write');
  const navigate = useNavigate();
  const model = useSettingsDraft();
  const { settings, loading, error, reload } = model;

  if (loading && !settings) {
    return (
      <PageSkeleton
        title="系统设置"
        description={
          editable
            ? '管理上传边界、冻结积分退回与数据备份。修改统一保存，生效时机以确认提示为准。'
            : '当前账号无 setting.write 权限，仅可查看。'
        }
        body={
          <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
            <SkeletonPanel rows={6} className="mb-0" />
            <div className="flex flex-col gap-4">
              <SkeletonPanel rows={4} className="mb-0" />
              <SkeletonPanel rows={3} className="mb-0" />
            </div>
          </div>
        }
      />
    );
  }
  if (error && !settings) return <ListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <EmptyState title="暂无配置项" />;

  const activeMeta = activeTab === 'security' ? null : CONFIG_TAB_META[activeTab];

  return (
    <AdminPage
      title="系统设置"
      description={
        editable
          ? '管理上传边界、冻结积分退回与数据备份。修改统一保存，生效时机以确认提示为准。'
          : '当前账号无 setting.write 权限，仅可查看。'
      }
      actions={
        editable ? (
          model.dirtyCount > 0 ? (
            <ToneBadge tone="warn">{model.dirtyCount} 项待保存</ToneBadge>
          ) : undefined
        ) : (
          <ToneBadge tone="neutral">只读</ToneBadge>
        )
      }
    >
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <AdminTabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isSettingsTabKey(value) || value === activeTab) return;
          navigate(settingGroupPath(value), { replace: true });
        }}
        items={SETTINGS_TABS}
        ariaLabel="系统设置"
      >
        <SettingsConfigTab tabKey="generate" model={model} editable={editable} />
        <SettingsConfigTab tabKey="upload" model={model} editable={editable} />
        <SettingsConfigTab tabKey="backup" model={model} editable={editable} />
        <TabsContent value="security" className="min-w-0">
          <SettingsSecurityTab />
        </TabsContent>
      </AdminTabs>

      <SettingsSaveDialog model={model} activeMeta={activeMeta} />
    </AdminPage>
  );
}
