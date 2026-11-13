import { useState } from 'react';
import {
  AdminTabs,
  Notice,
  StatusTag,
  TabsContent,
  useAdminResource,
} from '~/admin-ui/primitives';
import { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { adminCapabilitiesApi, adminCapabilityModelsApi } from '../../../lib/api';
import type { AdminCapabilityControl } from '../../../types/api';
import type { AdminCapabilityModelListView, CapabilityPricingView } from '../../../types/model';
import { BindingPanel } from './BindingPanel';
import { CapabilityOverview } from './CapabilityOverview';
import {
  ADMIN_RUNTIME_LABELS,
  CAPABILITY_TABS,
  DEFAULT_OFFLINE_REASON,
  isCapabilityTab,
} from './constants';
import { ImpactPanel } from './ImpactPanel';
import { PricingPanel } from './PricingPanel';
import type { CapabilityTab } from './types';
import { formatUpdatedAt, runtimeTone } from './utils';

/**
 * 当前能力上下文。
 *
 * 左侧清单只展示名称与状态，右侧页签内容较长时容易忘记正在改哪一项；
 * 把名称、分组与运行结论固定在工作区顶部，四个页签共用同一上下文。
 */
function CapabilityContext({ capability }: { capability: AdminCapabilityControl }) {
  return (
    <div className="mb-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{capability.name}</h2>
        <StatusTag
          status={capability.runtime.effective}
          tone={runtimeTone(capability.runtime.effective)}
          label={ADMIN_RUNTIME_LABELS[capability.runtime.effective] ?? capability.runtime.effective}
        />
      </div>
      {capability.summary && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{capability.summary}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          能力 ID <span className="font-mono text-foreground">{capability.capabilityId}</span>
        </span>
        <span>
          分组 <span className="text-foreground">{capability.groupName}</span>
        </span>
        {capability.updatedAt && <span>开关更新 {formatUpdatedAt(capability.updatedAt)}</span>}
      </div>
    </div>
  );
}

/** 能力工作区：概览、绑定、售价、影响面按权限独立读取，不把无权请求打成错误。 */
export function CapabilityWorkspace({
  capability,
  tab,
  onTabChange,
  capabilityWritable,
  bindingReadable,
  bindingWritable,
  pricingReadable,
  pricingWritable,
  revision,
  onChanged,
}: {
  capability: AdminCapabilityControl;
  tab: CapabilityTab;
  onTabChange: (tab: CapabilityTab) => void;
  capabilityWritable: boolean;
  bindingReadable: boolean;
  bindingWritable: boolean;
  pricingReadable: boolean;
  pricingWritable: boolean;
  /** 页面级写操作（如跨能力清理）后递增，强制重新读取当前能力的绑定。 */
  revision?: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [savingEnabled, setSavingEnabled] = useState(false);
  const bindings = useAdminResource<AdminCapabilityModelListView | null>(
    () =>
      bindingReadable
        ? adminCapabilityModelsApi.list(capability.capabilityId)
        : Promise.resolve(null),
    [capability.capabilityId, bindingReadable, revision],
  );
  const pricing = useAdminResource<CapabilityPricingView | null>(
    () =>
      pricingReadable
        ? adminCapabilityModelsApi.pricing(capability.capabilityId)
        : Promise.resolve(null),
    [capability.capabilityId, pricingReadable],
  );

  const runToggle = async (next: boolean) => {
    setSavingEnabled(true);
    try {
      await adminCapabilitiesApi.set(
        capability.capabilityId,
        next,
        next ? undefined : DEFAULT_OFFLINE_REASON,
      );
      toast.success(next ? '能力已上线，可继续检查绑定线路。' : '能力已下线，C 端已停止提交。');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败');
    } finally {
      setSavingEnabled(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    if (next) {
      await runToggle(true);
      return;
    }

    const confirmed = await confirm({
      title: `下线「${capability.name}」？`,
      description: (
        <>
          C 端会立即停止提交，并统一提示「{DEFAULT_OFFLINE_REASON}」。已创建任务继续执行，
          下线不会触发退款。
        </>
      ),
      confirmText: '确认下线',
      danger: true,
    });
    if (confirmed === null) return;
    // 取消确认不改变当前页签；确认后再切到影响面，便于操作后继续核对。
    onTabChange('impact');
    await runToggle(false);
  };

  return (
    <>
      <CapabilityContext capability={capability} />
      <AdminTabs
        value={tab}
        onValueChange={(value) => {
          if (isCapabilityTab(value)) onTabChange(value);
        }}
        items={CAPABILITY_TABS}
        ariaLabel="能力配置视图"
      >
        <TabsContent value="overview" className="m-0">
          <CapabilityOverview
            capability={capability}
            bindings={bindings.data}
            bindingsLoading={bindings.loading}
            bindingsError={bindings.error}
            pricing={pricing.data}
            pricingLoading={pricing.loading}
            pricingError={pricing.error}
            bindingsReadable={bindingReadable}
            pricingReadable={pricingReadable}
            capabilityWritable={capabilityWritable}
            savingEnabled={savingEnabled}
            onToggle={(next) => void toggleEnabled(next)}
          />
        </TabsContent>

        <TabsContent value="bindings" className="m-0">
          {bindingReadable ? (
            <BindingPanel
              capabilityId={capability.capabilityId}
              data={bindings.data}
              loading={bindings.loading}
              error={bindings.error}
              writable={bindingWritable}
              onRetry={() => void bindings.reload()}
              onChanged={onChanged}
            />
          ) : (
            <Notice tone="locked" title="无法查看候选商品">
              当前账号没有商品绑定读取权限。仍可查看能力状态与影响面，但无法判断具体线路。
            </Notice>
          )}
        </TabsContent>

        <TabsContent value="pricing" className="m-0">
          {pricingReadable ? (
            <PricingPanel
              capabilityId={capability.capabilityId}
              capabilityName={capability.name}
              data={pricing.data}
              loading={pricing.loading}
              error={pricing.error}
              writable={pricingWritable}
              onRetry={pricing.reload}
            />
          ) : (
            <Notice tone="locked" title="无法查看能力售价">
              当前账号没有售价查看权限。仍可查看能力状态与影响面，但无法读取或修改售价。
            </Notice>
          )}
        </TabsContent>

        <TabsContent value="impact" className="m-0">
          <ImpactPanel
            capability={capability}
            bindings={bindings.data}
            bindingsLoading={bindings.loading}
            bindingsError={bindings.error}
            pricing={pricing.data}
            pricingLoading={pricing.loading}
            pricingError={pricing.error}
            bindingsReadable={bindingReadable}
            pricingReadable={pricingReadable}
          />
        </TabsContent>
      </AdminTabs>
    </>
  );
}
