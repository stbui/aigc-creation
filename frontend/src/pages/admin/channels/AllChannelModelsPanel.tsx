import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminChannelModelsApi, adminChannelsApi, fetchChannelHealth } from './api';
import {
  AdminDataTable,
  StaleError,
  ActionButton,
  useSelectionPrune,
} from '~/admin-ui/primitives';
import { useAllChannelModelsColumns } from './AllChannelModelsColumns';
import { AllChannelModelsFilters } from './AllChannelModelsFilters';
import { ModelCommerceOverview } from './ModelCommerceOverview';
import { consumptionImpactText } from './useProductConsumption';
import { useAdmin, useConfirm, useToast, useAdminUrlFilterSync } from './hooks';
import { productStateOf } from './utils';
import {
  ALL_MODELS_COMMERCE_OPTIONS,
  ALL_MODELS_PAGE_SIZE,
  ALL_MODELS_STATUS_OPTIONS,
  type AllModelsCommerceFilter,
  type AllModelsStatusFilter,
} from './constants';
import { testErrorText, testFailureText } from './modelTest';
import { useModelCommerce } from './useModelCommerce';
import type { ProductConsumptionState } from './useProductConsumption';
import type { ProductStatusCounts } from './ProductStatusStrip';
import type {
  AdminChannelModelListItem,
  ChannelModelHealthRowView,
  ChannelOrderItemView,
} from '../../../types/model';

/** 「不健康」的阈值：24h 成功率低于 80% */
const UNHEALTHY_RATE = 0.8;

/**
 * 跨供应商「商品台账」：先回答「哪个商品能卖、卖得怎么样、被谁消费」，
 * 再下钻到供应商配置。商品列表、经营数据、健康与消费关系各自独立取数：
 * 任何辅助数据失败都不应把台账本身打成一页错误。
 */
export function AllChannelModelsPanel({
  writable,
  canTest,
  consumption,
  onChanged,
  onOpenChannel,
  onEditModel,
}: {
  writable: boolean;
  canTest: boolean;
  consumption: ProductConsumptionState;
  onChanged: () => void;
  onOpenChannel?: (channelId: string) => void;
  onEditModel?: (channelId: string, modelId: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAdmin();
  const canReadAnalytics = can('model.analytics_read');

  const [models, setModels] = useState<AdminChannelModelListItem[] | null>(null);
  const [health, setHealth] = useState<ChannelModelHealthRowView[]>([]);
  const [channels, setChannels] = useState<ChannelOrderItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  const [initialSearch] = useSearchParams();
  const [keyword, setKeyword] = useState(() => initialSearch.get('keyword') ?? '');
  const [capability, setCapability] = useState<string | undefined>(
    () => initialSearch.get('capability') ?? undefined,
  );
  const [status, setStatus] = useState<AllModelsStatusFilter>(() => {
    const value = initialSearch.get('status');
    return ALL_MODELS_STATUS_OPTIONS.some((option) => option.value === value)
      ? (value as AllModelsStatusFilter)
      : 'all';
  });
  const [channelFilter, setChannelFilter] = useState<string | undefined>(
    () => initialSearch.get('channel') ?? undefined,
  );
  const [commerceFilter, setCommerceFilter] = useState<AllModelsCommerceFilter | undefined>(() => {
    const value = initialSearch.get('commerce');
    return ALL_MODELS_COMMERCE_OPTIONS.some((option) => option.value === value)
      ? (value as AllModelsCommerceFilter)
      : undefined;
  });
  const [page, setPage] = useState(1);

  useAdminUrlFilterSync({
    keyword: keyword || undefined,
    capability,
    status: status === 'all' ? undefined : status,
    channel: channelFilter,
    commerce: canReadAnalytics ? commerceFilter : undefined,
  });

  const {
    overview,
    loading: commerceLoading,
    error: commerceError,
    reload: reloadCommerce,
    byModelId: commerceByModelId,
  } = useModelCommerce(canReadAnalytics, 7);

  // 经营数据不可用时，经营筛选也失效。保留它只会得到一张无法解释的空表；
  // 清掉筛选并同步地址栏，商品台账仍可按状态 / 关键词正常使用。
  useEffect(() => {
    if (!canReadAnalytics || commerceLoading || !commerceError || overview) return;
    if (!commerceFilter) return;
    setCommerceFilter(undefined);
    setPage(1);
  }, [canReadAnalytics, commerceFilter, commerceError, commerceLoading, overview]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 含停用项：跨渠道视图也是找回停用商品并重新启用的入口。
      const res = await adminChannelModelsApi.list(undefined, true);
      setModels(res.models);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 健康与渠道名是辅助数据：读取失败不阻塞列表。
    void fetchChannelHealth()
      .then((res) => setHealth(res.items))
      .catch(() => setHealth([]));
    void adminChannelsApi
      .order()
      .then((res) => setChannels(res.items))
      .catch(() => setChannels([]));
  }, [load]);

  const channelNameById = useMemo(() => {
    const map = new Map(channels.map((item) => [item.id, item.name]));
    for (const row of health) map.set(row.channelId, row.channelName);
    return map;
  }, [channels, health]);

  const healthByModelId = useMemo(
    () => new Map(health.map((row) => [row.id, row])),
    [health],
  );

  const rows = models ?? [];

  /** 显示名 → 模型标识 → 渠道名；同模型在不同渠道的行保持相邻。 */
  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const nameOf = (item: AdminChannelModelListItem) =>
      item.channelName || channelNameById.get(item.channelId) || '';
    return rows
      .filter((item) => {
        if (
          query &&
          !`${item.modelKey} ${item.providerModelKey} ${item.displayName} ${item.channelLabel} ${item.channelName}`
            .toLowerCase()
            .includes(query)
        ) {
          return false;
        }
        if (capability && item.capability !== capability) return false;
        if (channelFilter && item.channelId !== channelFilter) return false;

        const state = productStateOf(item, item.channelEnabled);
        if (status === 'enabled' && state !== 'available') return false;
        if (status === 'disabled' && state !== 'disabled') return false;
        if (status === 'unhealthy') {
          const rate = healthByModelId.get(item.id)?.windows.day.successRate;
          // 无样本不算不健康。
          if (rate === null || rate === undefined || rate >= UNHEALTHY_RATE) return false;
        }
        if (status === 'unpriced' && state !== 'unpriced') return false;
        if (status === 'unconfigured' && state !== 'unconfigured') return false;
        if (status === 'cooling' && !healthByModelId.get(item.id)?.coolingUntil) return false;

        if (commerceFilter && canReadAnalytics) {
          const commerce = commerceByModelId.get(item.id);
          if (commerceFilter === 'pending-pricing' && item.priceConfigured) return false;
          if (commerceFilter === 'no-calls' && !commerce?.noCalls) return false;
          if (commerceFilter === 'low-margin' && !commerce?.lowMargin) return false;
          if (commerceFilter === 'high-refund' && !commerce?.highRefund) return false;
          if (commerceFilter === 'invalid-binding' && (commerce?.invalidBindingCount ?? 0) <= 0) {
            return false;
          }
          if (
            commerceFilter === 'supplier-disabled' &&
            item.channelEnabled &&
            commerce?.channelEnabled !== false
          ) {
            return false;
          }
        }
        return true;
      })
      .sort(
        (left, right) =>
          (left.displayName || left.modelKey).localeCompare(
            right.displayName || right.modelKey,
            'zh-CN',
          ) ||
          left.modelKey.localeCompare(right.modelKey) ||
          nameOf(left).localeCompare(nameOf(right), 'zh-CN'),
      );
  }, [
    rows,
    keyword,
    capability,
    channelFilter,
    status,
    commerceFilter,
    canReadAnalytics,
    commerceByModelId,
    healthByModelId,
    channelNameById,
  ]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * ALL_MODELS_PAGE_SIZE, page * ALL_MODELS_PAGE_SIZE),
    [filtered, page],
  );
  useSelectionPrune(setSelectedIds, useMemo(() => paged.map((row) => row.id), [paged]));

  const applyEnabled = async (item: AdminChannelModelListItem, enabled: boolean) => {
    setTogglingId(item.id);
    try {
      await adminChannelsApi.setModelEnabled(item.channelId, item.id, enabled);
      setModels((current) =>
        (current ?? []).map((entry) => (entry.id === item.id ? { ...entry, enabled } : entry)),
      );
      toast.success(enabled ? `已启用 ${item.modelKey}` : `已停用 ${item.modelKey}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新商品状态失败');
    } finally {
      setTogglingId(null);
    }
  };

  /** 停用会让消费该商品的能力切换到其他线路，必须二次确认。 */
  const toggleEnabled = async (item: AdminChannelModelListItem) => {
    if (!item.enabled) {
      await applyEnabled(item, true);
      return;
    }
    const impact = consumptionImpactText(consumption.byModelId.get(item.id) ?? []);
    const confirmed = await confirm({
      title: `停用 ${item.channelName || channelNameById.get(item.channelId) || '该供应商'} 的 ${item.displayName || item.modelKey}？`,
      description: `停用后新任务不再使用这个供应商的该商品，消费它的售卖配置可能切换到其他可用商品；若没有替代线路，能力会暂时不可用。配置保留，可随时重新启用。${impact}。`,
      confirmText: '确认停用',
      danger: true,
    });
    if (confirmed === null) return;
    await applyEnabled(item, false);
  };

  /** 从台账直接发起连通测试；失败详情保留 message / error / errorCode / logId。 */
  const runTest = async (item: AdminChannelModelListItem) => {
    setTestingId(item.id);
    try {
      const result = await adminChannelsApi.testModel(item.channelId, {
        modelId: item.id,
        waitForResult: false,
      });
      if (result.status === 'succeeded') {
        toast.success(`「${item.displayName || item.modelKey}」连通正常`);
      } else if (result.status === 'pending') {
        toast.info(`「${item.displayName || item.modelKey}」测试已提交`, result.taskId || undefined);
      } else {
        toast.error('连通测试失败', testFailureText(result));
      }
    } catch (e) {
      toast.error('连通测试失败', testErrorText(e));
    } finally {
      setTestingId(null);
    }
  };

  /** 批量上架 / 下架：逐条调用既有启停接口，逐条返回失败。 */
  const runBatchToggle = async (enabled: boolean) => {
    const selected = rows.filter((row) => selectedIds.includes(row.id));
    const targets = selected.filter((row) => row.enabled !== enabled);
    if (targets.length === 0) {
      toast.warning(`所选商品都已经是${enabled ? '启用' : '停用'}状态`);
      return;
    }

    let eligible = targets;
    if (enabled) {
      eligible = targets.filter(
        (row) =>
          Boolean(row.capability) &&
          Boolean(row.protocol) &&
          row.priceConfigured &&
          row.channelEnabled,
      );
      if (eligible.length === 0) {
        toast.error('所选商品都未配置完整（类型 / 接入方式 / 售价），或供应商已停用，无法上架');
        return;
      }
    }

    const skipped = targets.length - eligible.length;
    const confirmed = await confirm({
      title: enabled
        ? `批量上架 ${eligible.length} 个商品？`
        : `批量下架 ${eligible.length} 个商品？`,
      description: enabled
        ? `${skipped > 0 ? `${skipped} 个商品因缺类型 / 接入方式 / 售价或供应商停用会被跳过。` : ''}上架后可被能力选用。`
        : '下架后新任务不再使用这些商品；消费它们的售卖配置可能切换到其他可用商品，若没有替代线路，能力会暂时不可用。配置与售价保留，可随时重新上架。',
      confirmText: enabled ? '确认上架' : '确认下架',
      danger: !enabled,
    });
    if (confirmed === null) return;

    setBatchBusy(true);
    const failures: string[] = [];
    try {
      for (const row of eligible) {
        try {
          await adminChannelsApi.setModelEnabled(row.channelId, row.id, enabled);
        } catch (e) {
          failures.push(`${row.modelKey}：${e instanceof Error ? e.message : '操作失败'}`);
        }
      }
      if (failures.length > 0) {
        toast.error(
          `已处理 ${eligible.length - failures.length} 个，${failures.length} 个失败：${failures
            .slice(0, 2)
            .join('；')}`,
        );
      } else {
        toast.success(`已${enabled ? '上架' : '下架'} ${eligible.length} 个商品`);
      }
      setSelectedIds([]);
      await load();
      onChanged();
    } finally {
      setBatchBusy(false);
    }
  };

  const hasFilters = Boolean(
    keyword.trim() ||
      capability ||
      status !== 'all' ||
      channelFilter ||
      (canReadAnalytics && commerceFilter),
  );

  const updateFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const availableCount = filtered.filter(
    (item) => productStateOf(item, item.channelEnabled) === 'available',
  ).length;

  const statusCounts = useMemo<ProductStatusCounts>(() => {
    const counts: ProductStatusCounts = {
      available: 0,
      unpriced: 0,
      unconfigured: 0,
      disabled: 0,
      cooling: 0,
    };
    for (const row of rows) {
      counts[productStateOf(row, row.channelEnabled)] += 1;
      if (healthByModelId.get(row.id)?.coolingUntil) counts.cooling += 1;
    }
    return counts;
  }, [healthByModelId, rows]);

  const columns = useAllChannelModelsColumns({
    channelNameById,
    healthByModelId,
    commerceByModelId,
    consumption,
    loading,
    commerceLoading,
    canTest,
    writable,
    togglingId,
    testingId,
    onOpenChannel,
    onEditModel,
    onToggle: (row) => void toggleEnabled(row),
    onTest: (row) => void runTest(row),
  });

  const channelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.channelId, row.channelName || channelNameById.get(row.channelId) || '');
    }
    for (const item of channels) if (!map.has(item.id)) map.set(item.id, item.name);
    return [...map.entries()].map(([value, label]) => ({ value, label: label || value }));
  }, [rows, channels, channelNameById]);

  const resetFilters = () => {
    setKeyword('');
    setCapability(undefined);
    setStatus('all');
    setChannelFilter(undefined);
    setCommerceFilter(undefined);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-3">
      {canReadAnalytics && (
        <ModelCommerceOverview
          overview={overview}
          loading={commerceLoading}
          error={commerceError}
          onRetry={() => void reloadCommerce()}
        />
      )}

      <AllChannelModelsFilters
        counts={statusCounts}
        status={status}
        keyword={keyword}
        capability={capability}
        channelFilter={channelFilter}
        commerceFilter={commerceFilter}
        channelOptions={channelOptions}
        showCommerce={canReadAnalytics}
        commerceReady={overview !== null}
        total={filtered.length}
        available={availableCount}
        loading={loading}
        onStatusChange={(next) => updateFilter(() => setStatus(next))}
        onKeywordChange={(next) => updateFilter(() => setKeyword(next))}
        onCapabilityChange={(next) => updateFilter(() => setCapability(next))}
        onChannelChange={(next) => updateFilter(() => setChannelFilter(next))}
        onCommerceChange={(next) => updateFilter(() => setCommerceFilter(next))}
        onReset={resetFilters}
      />

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">已选 {selectedIds.length} 个商品</span>
          <ActionButton
            variant="secondary"
            size="xs"
            disabled={batchBusy || togglingId !== null}
            onClick={() => void runBatchToggle(true)}
          >
            批量上架
          </ActionButton>
          <ActionButton
            variant="secondary"
            size="xs"
            disabled={batchBusy || togglingId !== null}
            onClick={() => void runBatchToggle(false)}
          >
            批量下架
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={batchBusy}
            onClick={() => setSelectedIds([])}
          >
            取消选择
          </ActionButton>
          {batchBusy && <span className="text-xs text-muted-foreground">处理中…</span>}
        </div>
      )}

      {error && rows.length === 0 && <StaleError error={error} onRetry={() => void load()} />}

      <AdminDataTable<AdminChannelModelListItem>
        rows={paged}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        selectable
        selected={selectedIds}
        onSelectedChange={setSelectedIds}
        rowSelectLabel={(row) => `选择商品 ${row.modelKey}`}
        emptyText={hasFilters ? '没有匹配的商品' : '暂无商品'}
        density="compact"
        minWidth={1120}
        pagination={{
          current: page,
          pageSize: ALL_MODELS_PAGE_SIZE,
          total: filtered.length,
          onChange: (next) => setPage(next),
        }}
      />
    </div>
  );
}
