import { useCallback, useMemo, useState } from 'react';
import { adminPaymentProvidersApi } from './api';
import {
  EmptyState,
  ListError,
  SegmentedGroup,
  SkeletonCards,
  StaleError,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminResource,
  useRefreshOnNonce,
} from './hooks';
import type { AdminPaymentProviderView } from '../../../types/payment';
import { providerState } from './utils';
import {
  PAYMENT_PROVIDER_STATE_META,
  type PaymentProviderState,
} from './constants';
import { PaymentsProviderCard } from './PaymentsProviderCard';
import { PaymentsProviderInstancesDrawer } from './PaymentsProviderInstancesDrawer';
import { PaymentsProviderSummary } from './PaymentsProviderSummary';
import { PaymentsVisibleMethodsCard } from './PaymentsVisibleMethodsCard';

/**
 * 支付渠道标签。
 *
 * 渠道配置**加密落库并版本化**：每次保存追加一个新版本，历史订单固定用
 * 下单时的版本（换密钥后旧订单的回调仍要能验签）。渠道只做实例管理，不做删除。
 *
 * 每个渠道可包含多个服务商实例；概览状态按 `instances[]` 聚合，不能只看顶层
 * `enabled/configured` 兼容投影。
 */

/** 列表默认按「需要处理」的优先级排序，异常渠道永远先出现。 */
const PROVIDER_STATE_RANK: Record<PaymentProviderState, number> = {
  misconfigured: 0,
  unconfigured: 1,
  usable: 2,
  disabled: 3,
};

export function PaymentsProvidersTab({ refreshNonce }: { refreshNonce: number }) {
  const { can } = useAdmin();
  const writable = can('payment.write');

  const { data, loading, error, reload } = useAdminResource(() =>
    adminPaymentProvidersApi.list(),
  );

  // 刷新按钮只重取数据，不重置当前状态筛选
  useRefreshOnNonce(refreshNonce, reload);

  const [editing, setEditing] = useState<AdminPaymentProviderView | null>(null);
  /** 卡片区的状态筛选；只影响展示，不改数据源 */
  const [stateFilter, setStateFilter] = useState('all');

  const providers = data?.items ?? [];

  const closeInstances = useCallback(() => {
    setEditing(null);
    void reload();
  }, [reload]);

  /*
   * 派生量全部在**早退之前**算完。
   *
   * 早退（骨架 / 失败 / 空态）在 hook 之后是安全的，在 hook 之前不是 ——
   * 加载态与数据态渲染的 hook 数量不同，React 会直接报错。把派生计算提到
   * 早退之前，hook 顺序就恒定。
   */
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const provider of providers) {
      const state = providerState(provider);
      counts[state] = (counts[state] ?? 0) + 1;
    }
    return counts;
  }, [providers]);

  /* 筛选档位只列**真的有渠道**的那些；「全部」始终在。 */
  const filterOptions = useMemo(() => {
    const options = [{ value: 'all', label: '全部' }];
    for (const [state, meta] of Object.entries(PAYMENT_PROVIDER_STATE_META)) {
      const count = stateCounts[state] ?? 0;
      if (count > 0) options.push({ value: state, label: meta.label });
    }
    return options;
  }, [stateCounts]);

  const visibleProviders = useMemo(() => {
    const filtered =
      stateFilter === 'all'
        ? providers
        : providers.filter((provider) => providerState(provider) === stateFilter);

    return [...filtered].sort((a, b) => {
      const rankDiff =
        PROVIDER_STATE_RANK[providerState(a)] - PROVIDER_STATE_RANK[providerState(b)];
      return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [providers, stateFilter]);

  /* 标签页内的加载骨架只占卡片区域，页头、页签、提示条已经渲染好了。 */
  if (loading && !data) {
    return (
      <SkeletonCards
        count={6}
        className="mt-0"
        gridClassName="grid-cols-1 lg:grid-cols-2"
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data || providers.length === 0) return <EmptyState title="没有发现支付渠道" />;

  return (
    <div className="flex flex-col gap-3">
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <PaymentsProviderSummary providers={providers} />

      <PaymentsVisibleMethodsCard
        providers={providers}
        writable={writable}
        onSaved={() => void reload()}
      />

      <div className="flex items-center justify-between gap-4 px-0.5">
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 text-[13px] font-semibold text-foreground">渠道列表</h2>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {visibleProviders.length} 个
          </span>
        </div>
        {filterOptions.length > 2 && (
          <SegmentedGroup
            value={stateFilter}
            onChange={setStateFilter}
            options={filterOptions}
            ariaLabel="按渠道状态筛选"
          />
        )}
      </div>

      {visibleProviders.length === 0 ? (
        <EmptyState title="该状态下暂无渠道" />
      ) : (
        <div
          data-testid="admin-provider-grid"
          className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2"
        >
          {visibleProviders.map((provider) => (
            <PaymentsProviderCard
              key={provider.id}
              provider={provider}
              writable={writable}
              onConfigure={() => setEditing(provider)}
            />
          ))}
        </div>
      )}

      {editing && (
        <PaymentsProviderInstancesDrawer
          key={editing.id}
          open
          provider={editing}
          writable={writable}
          onClose={closeInstances}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}
