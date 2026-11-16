import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, ListChecks, Send, Settings2 } from 'lucide-react';

import {
  ActionButton,
  AdminPage,
  AdminTabs,
  EmptyState,
  ListError,
  Notice,
  PageSkeleton,
  SkeletonPanel,
  StaleError,
  TabsContent,
  ToneBadge,
} from './components';
import { EmailDeliveryTab } from './EmailDeliveryTab';
import { EmailOverview } from './EmailOverview';
import { EmailSaveBar } from './EmailSaveBar';
import { EmailTemplatesTab } from './EmailTemplatesTab';
import { EmailUsageTab } from './EmailUsageTab';
import { useAdmin } from './hooks';
import { useEmailChannel } from './useEmailChannel';
import { useEmailConfig } from './useEmailConfig';
import { emailPageTab, emailRuntimeState } from './utils';

/**
 * 独立邮箱配置页。
 *
 * 邮箱不是普通系统参数：它包含投递通道选择、凭据、发件身份、业务事件开关与
 * 真实发信验证，运营需要围绕一条“配置 → 验证 → 使用”的链路工作。因此这里不
 * 复用系统设置的分组工作台，而是按邮件业务单独组织页面。
 *
 * 页面只负责分区切换（含 `?tab=` 同步）与组合：配置草稿在 `useEmailConfig`，
 * 通道运行状态与测试发信在 `useEmailChannel`，投递派生状态由
 * `emailRuntimeState` 统一算一次，三个分区各自成组件。
 */
export function AdminEmailPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAdmin();
  const writable = can('setting.write');
  const canInspectChannel = can('message.write');

  const activeTab = emailPageTab(searchParams.get('tab'));

  const changeTab = (next: string) => {
    const tab = emailPageTab(next);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (tab === 'delivery') params.delete('tab');
        else params.set('tab', tab);
        return params;
      },
      { replace: true },
    );
  };

  const channelState = useEmailChannel(canInspectChannel);
  const config = useEmailConfig(channelState.reload);
  const runtime = emailRuntimeState(config.valueFor, config.configuredFor);

  const tabs = [
    {
      value: 'delivery',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Settings2 className="size-3.5" aria-hidden />
          投递配置
        </span>
      ),
    },
    {
      value: 'usage',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="size-3.5" aria-hidden />
          业务用途
          <span className="rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground tabular-nums">
            {runtime.enabledEventCount}/{runtime.eventKeys.length}
          </span>
        </span>
      ),
    },
    {
      value: 'templates',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5" aria-hidden />
          邮件模板
        </span>
      ),
    },
  ];

  if (config.loading && !config.settings) {
    return (
      <PageSkeleton
        title="邮箱配置"
        description={
          writable
            ? '正在读取邮件投递通道、发件身份与业务邮件配置'
            : '正在读取邮箱配置与通道状态'
        }
        body={
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <SkeletonPanel rows={4} className="mb-4" />
              <SkeletonPanel rows={7} className="mb-4" />
              <SkeletonPanel rows={8} className="mb-0" />
            </div>
            <SkeletonPanel rows={6} className="mb-0" />
          </div>
        }
      />
    );
  }
  if (config.error && !config.settings) {
    return <ListError error={config.error} onRetry={() => void config.reload()} />;
  }
  if (!config.settings) return <EmptyState title="暂时无法读取邮箱配置" />;

  return (
    <AdminPage
      title="邮箱配置"
      description={
        writable
          ? '统一管理邮件投递通道、发件身份、业务邮件通知与发送模板。保存后仅影响后续邮件；正式启用前建议先完成测试发信。'
          : '当前账号仅可查看邮箱配置和通道状态，无修改权限。'
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canInspectChannel ? (
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={channelState.loading || channelState.testing}
              onClick={() => void channelState.reload()}
            >
              刷新状态
            </ActionButton>
          ) : null}
          {can('message.write') ? (
            <ActionButton
              variant="outline"
              size="sm"
              icon={Send}
              onClick={() => navigate('/admin/notifications')}
            >
              发送活动消息
            </ActionButton>
          ) : null}
          <ToneBadge
            tone={config.dirtyCount > 0 ? 'warn' : writable ? 'success' : 'neutral'}
          >
            {config.dirtyCount > 0
              ? `${config.dirtyCount} 项未保存`
              : writable
                ? '无未保存修改'
                : '仅查看'}
          </ToneBadge>
        </div>
      }
    >
      {config.error && <StaleError error={config.error} onRetry={() => void config.reload()} />}
      {!writable && (
        <Notice tone="locked" title="仅查看模式" className="mb-4">
          当前账号仅可查看邮箱配置和通道状态，无法修改或保存配置。如需调整，请联系具备系统设置管理权限的管理员。
        </Notice>
      )}

      {config.items.length > 0 ? (
        <>
          <EmailOverview
            enabled={runtime.enabled}
            provider={runtime.provider}
            from={runtime.from}
            alias={runtime.alias}
            configReady={runtime.providerState.ready}
            configMessage={runtime.providerState.message}
            channel={channelState.channel}
            channelLoading={channelState.loading}
            channelError={channelState.error}
            canInspectChannel={canInspectChannel}
          />

          <AdminTabs
            value={activeTab}
            onValueChange={changeTab}
            items={tabs}
            ariaLabel="邮箱配置分区"
            className="gap-4"
          >
            <TabsContent value="delivery" className="m-0">
              <EmailDeliveryTab
                config={config}
                channelState={channelState}
                runtime={runtime}
                writable={writable}
                canInspectChannel={canInspectChannel}
              />
            </TabsContent>

            <TabsContent value="usage" className="m-0">
              <EmailUsageTab
                config={config}
                runtime={runtime}
                writable={writable}
                onChangeTab={changeTab}
              />
            </TabsContent>

            <TabsContent value="templates" className="m-0">
              <EmailTemplatesTab
                dirtyCount={config.dirtyCount}
                canManage={canInspectChannel}
                onChangeTab={changeTab}
              />
            </TabsContent>
          </AdminTabs>

          {activeTab !== 'templates' ? (
            <EmailSaveBar
              dirtyCount={config.dirtyCount}
              saving={config.saving}
              writable={writable}
              onDiscard={config.discard}
              onSave={() => void config.save()}
            />
          ) : null}
        </>
      ) : (
        <EmptyState
          title="暂时无法读取邮箱配置"
          description="未获取到邮箱配置项，请刷新页面后重试。如问题持续，请联系系统管理员。"
          action={<ActionButton onClick={() => void config.reload()}>重新加载</ActionButton>}
        />
      )}
    </AdminPage>
  );
}
