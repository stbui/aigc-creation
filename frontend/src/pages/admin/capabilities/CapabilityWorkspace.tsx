import { useState } from 'react';
import {
  AdminTabs,
  Notice,
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
import { CAPABILITY_TABS, DEFAULT_OFFLINE_REASON, isCapabilityTab } from './constants';
import { ImpactPanel } from './ImpactPanel';
import { PricingPanel } from './PricingPanel';
import type { CapabilityTab } from './types';

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
      toast.success(next ? '能力已上线' : '能力已下线');
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

    const bindingsText = bindingReadable
      ? `当前 ${capability.runtime.remoteAvailable ? '有' : '没有'}可运行线路，`
      : '当前账号不可查看绑定明细，';
    const confirmed = await confirm({
      title: `下线「${capability.name}」？`,
      description: (
        <>
          {bindingsText}C 端会立即停止提交，并统一提示「{DEFAULT_OFFLINE_REASON}」。
          已创建任务不受影响，也不会因为下线自动退款。
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
          <Notice tone="locked" title="无法查看候选模型">
            需要 logical_model.read 权限。当前仍可查看能力运行结论，但不能判断具体线路。
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
            需要 product.price 权限。售价由 CapabilityPricing 统一提供，当前账号没有读取权限。
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
  );
}
