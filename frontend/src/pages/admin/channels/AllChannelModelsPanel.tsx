import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Power } from 'lucide-react';
import { adminChannelModelsApi, adminChannelsApi, fetchChannelHealth } from './api';
import {
  AdminDataTable,
  Button,
  StaleError,
  ActionButton,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  StatusTag,
  useSelectionPrune,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { ChannelModelCapabilityTag } from './ChannelModelCapabilityTag';
import { ProductConsumptionCell } from './ProductConsumptionCell';
import { ProductStatusStrip, type ProductStatusCounts } from './ProductStatusStrip';
import { consumptionImpactText } from './useProductConsumption';
import { useConfirm, useToast, useAdminUrlFilterSync } from './hooks';
import { ChannelModelCostSummary, ChannelModelHealthCell } from './ChannelModelHealthCell';
import { PRODUCT_STATE_META, productStateOf } from './utils';
import {
  ALL_MODELS_PAGE_SIZE,
  ALL_MODELS_STATUS_OPTIONS,
  CAPABILITY_OPTIONS,
  type AllModelsStatusFilter,
} from './constants';
import type { ProductConsumptionState } from './useProductConsumption';
import type {
  AdminChannelModelListItem,
  ChannelModelHealthRowView,
  ChannelOrderItemView,
} from '../../../types/model';

/**
 * 跨供应商「商品台账」视图，也是页面默认视图。
 *
 * ## 为什么要这个视图
 *
 * 供应商视图是「按渠道」组织的：看到某条线不对，要先知道它在哪个渠道，
 * 再选中那条渠道才能看价格与健康。但运营的第一问题往往是「**哪个商品**
 * 能卖、被谁消费」—— 跨供应商看才答得上来。
 *
 * ## 筛选口径
 *
 * · **状态**分七档：全部 / 可用 / 已停用 / 不健康 / 待定价 / 待配置 / 冷却中。
 *   「可用」= 商品自身启用、所属供应商启用、已定价且声明了类型与接入方式；
 *   「已停用」= 商品或供应商其一停用；具体是谁停用放在状态悬停里，
 *   列表上不再并排两枚胶囊；
 *   「不健康」= 24h 成功率低于 80%（**无样本不算不健康** ——
 *   「没调用过」与「在挂」是两件事，混在一起会让刚上线的线全部标红）；
 *   「待定价」= 没有任何已配置价格档（补价工作队列）；
 *   「待配置」= 上游导入的骨架行还没声明类型或接入方式；
 *   「冷却中」= 明确可归因失败后的临时退避，与商品状态正交。
 *
 * ## 一次取回全部，前端筛选
 *
 * 后端 `/admin/channel-models` 不分页（线路数量在百级，前端筛选 + 分页
 * 比服务端分页更好做「跨维度」筛选）。超过 2000 条时按需提示。
 */

/** 「不健康」的阈值：24h 成功率低于 80% */
const UNHEALTHY_RATE = 0.8;

export function AllChannelModelsPanel({
  writable,
  consumption,
  onChanged,
  onOpenChannel,
  onEditModel,
}: {
  writable: boolean;
  consumption: ProductConsumptionState;
  onChanged: () => void;
  /** 点供应商名跳回「按供应商」视图并选中该供应商；不传则名称只是文本 */
  onOpenChannel?: (channelId: string) => void;
  /** 点「编辑」跳回该供应商并直接打开这条商品的编辑器 */
  onEditModel?: (channelId: string, modelId: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [models, setModels] = useState<AdminChannelModelListItem[] | null>(null);
  const [health, setHealth] = useState<ChannelModelHealthRowView[]>([]);
  const [channels, setChannels] = useState<ChannelOrderItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  /*
   * 筛选从地址栏初始化：把「不健康 + 某渠道」视图发给同事要能直达。
   * 只在首次挂载读取，之后由组件 state 主导并回写 URL。
   */
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
  const [page, setPage] = useState(1);
  /*
   * 筛选写进地址栏：跨渠道排查经常要把「不健康 + 某渠道」这个视图发给同事，
   * 只存在组件 state 里的筛选点开链接就丢了（参考实现同口径）。
   */
  useAdminUrlFilterSync({
    keyword: keyword || undefined,
    capability,
    status: status === 'all' ? undefined : status,
    channel: channelFilter,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 含停用项：跨渠道视图是排查入口，看不到停用的模型就没有重新启用的入口
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
    // 健康与渠道名是辅助数据：读取失败不阻塞列表
    void fetchChannelHealth()
      .then((res) => setHealth(res.items))
      .catch(() => setHealth([]));
    void adminChannelsApi
      .order()
      .then((res) => setChannels(res.items))
      .catch(() => setChannels([]));
  }, [load]);

  /** 渠道 id → 名称（健康数据里也带渠道名，两处都能兜底） */
  const channelNameById = useMemo(() => {
    const map = new Map(channels.map((item) => [item.id, item.name]));
    for (const row of health) map.set(row.channelId, row.channelName);
    return map;
  }, [channels, health]);

  /** 健康数据按渠道模型 id 索引（跨渠道视图里模型 id 全局唯一） */
  const healthByModelId = useMemo(
    () => new Map(health.map((row) => [row.id, row])),
    [health],
  );

  const rows = models ?? [];

  /**
   * 筛选后按「显示名 → 模型标识 → 渠道名」排序。
   *
   * 与参考实现一致：同一模型在不同渠道的行相邻排列，才能横向比较
   * 价格、稳定性与启停状态 —— 这是这个视图存在的全部理由。
   */
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
          const stats = healthByModelId.get(item.id);
          const rate = stats?.windows.day.successRate;
          // 无样本不算不健康
          if (rate === null || rate === undefined || rate >= UNHEALTHY_RATE) return false;
        }
        // 待定价：商品存在但没有任何可用价格档 —— 补价工作队列
        if (status === 'unpriced' && state !== 'unpriced') return false;
        // 待配置：上游导入的骨架行还没声明能力 / 接入方式
        if (status === 'unconfigured' && state !== 'unconfigured') return false;
        // 冷却：明确可归因失败后的临时退避，与商品状态正交
        if (status === 'cooling' && !healthByModelId.get(item.id)?.coolingUntil) return false;
        return true;
      })
      .sort(
        (left, right) =>
          (left.displayName || left.modelKey).localeCompare(right.displayName || right.modelKey, 'zh-CN') ||
          left.modelKey.localeCompare(right.modelKey) ||
          nameOf(left).localeCompare(nameOf(right), 'zh-CN'),
      );
  }, [rows, keyword, capability, channelFilter, status, healthByModelId, channelNameById]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * ALL_MODELS_PAGE_SIZE, page * ALL_MODELS_PAGE_SIZE),
    [filtered, page],
  );
  const visibleIds = useMemo(() => paged.map((row) => row.id), [paged]);
  useSelectionPrune(setSelectedIds, visibleIds);

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

  /**
   * 停用不是纯展示开关：引用这条线路的前台模型会切到其它线路，
   * 线上的都切完就会 42204。所以停用前必须确认，启用则直接生效。
   */
  const toggleEnabled = async (item: AdminChannelModelListItem) => {
    if (!item.enabled) {
      await applyEnabled(item, true);
      return;
    }
    const impact = consumptionImpactText(consumption.byModelId.get(item.id) ?? []);
    const confirmed = await confirm({
      title: `停用 ${item.channelName || channelNameById.get(item.channelId) || '该供应商'} 的 ${item.displayName || item.modelKey}？`,
      description: `停用后新任务不再使用这个供应商的该商品，消费它的能力会切换到其他可用商品；配置保留，可随时重新启用。${impact}。`,
      confirmText: '确认停用',
      danger: true,
    });
    if (confirmed === null) return;
    await applyEnabled(item, false);
  };

  /** 批量上架 / 下架：逐条调用既有启停接口，逐条返回失败 */
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
        toast.error('所选商品都未配置完整（类型 / 接入方式 / 售价），无法上架');
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
        : '下架后新任务不再使用这些商品；消费它们的售卖配置会切换到其他可用商品。配置与售价保留，可随时重新上架。',
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
          failures.push(
            `${row.modelKey}：${e instanceof Error ? e.message : '操作失败'}`,
          );
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

  /** 任一筛选生效时，空表要区分「筛没了」与「本来就没有」 */
  const hasFilters = Boolean(keyword.trim() || capability || status !== 'all' || channelFilter);

  /** 筛选变化一律回到第 1 页：停在第 5 页筛选出 3 条会是一张空表 */
  const updateFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const availableCount = filtered.filter(
    (item) => productStateOf(item, item.channelEnabled) === 'available',
  ).length;

  /** 状态条按全量商品统计，不受当前筛选影响 */
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

  const columns: Array<AdminColumn<AdminChannelModelListItem>> = useMemo(
    () => [
      {
        key: 'model',
        title: '商品',
        width: 230,
        render: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground" title={row.displayName || row.modelKey}>
              {row.icon ? `${row.icon} ` : ''}
              {row.displayName || row.modelKey}
            </div>
            <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground" title={row.modelKey}>
              {row.modelKey}
            </div>
          </div>
        ),
      },
      {
        key: 'channel',
        title: '供应商',
        width: 140,
        render: (row) => {
          const name = row.channelName || channelNameById.get(row.channelId) || '—';
          return (
            <div className="min-w-0">
              {/* 排障动线：在这看到某条线不对，一步跳回它所属的渠道去改 */}
              {onOpenChannel ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto max-w-full justify-start overflow-hidden p-0 text-brand"
                  title="在供应商中查看"
                  onClick={() => onOpenChannel(row.channelId)}
                >
                  {name}
                </Button>
              ) : (
                <div className="truncate text-muted-foreground" title={name}>
                  {name}
                </div>
              )}
              {!row.channelEnabled && <div className="text-[12px] text-muted-foreground">渠道已停用</div>}
            </div>
          );
        },
      },
      {
        key: 'capability',
        title: '类型',
        width: 76,
        render: (row) => <ChannelModelCapabilityTag capability={row.capability} />,
      },
      {
        key: 'consumption',
        title: '消费能力',
        width: 170,
        render: (row) => (
          <ProductConsumptionCell
            refs={consumption.byModelId.get(row.id)}
            loading={consumption.loading}
            available={consumption.available}
          />
        ),
      },
      {
        key: 'health',
        title: '健康',
        width: 140,
        render: (row) => (
          <ChannelModelHealthCell health={healthByModelId.get(row.id)} loading={loading} />
        ),
      },
      {
        key: 'cost',
        title: '售价',
        width: 220,
        render: (row) => <ChannelModelCostSummary model={row} tiers={row.priceTiers} saleOnly />,
      },
      {
        key: 'status',
        title: '状态',
        width: 100,
        render: (row) => {
          const state = productStateOf(row, row.channelEnabled);
          const meta = PRODUCT_STATE_META[state];
          // 状态已收敛成四值，供应商 / 商品谁停用放到悬停里
          const detail =
            state === 'disabled' && !row.channelEnabled
              ? '所属供应商已停用'
              : state === 'disabled'
                ? '商品已停用'
                : undefined;
          return (
            <span title={detail}>
              <StatusTag status={`product-${state}`} tone={meta.tone} label={meta.label} />
            </span>
          );
        },
      },
      {
        key: 'ops',
        title: '操作',
        width: 160,
        fixed: 'right',
        render: (row) => (
          <div className="flex items-center gap-1">
            {/* 编辑直接打开这条模型的编辑器，不必先回到渠道再翻一遍清单 */}
            {onEditModel && (
              <ActionButton
                variant="secondary"
                size="sm"
                icon={Pencil}
                disabled={!writable}
                onClick={() => onEditModel(row.channelId, row.id)}
              >
                编辑
              </ActionButton>
            )}
            <ActionButton
              variant="ghost"
              size="sm"
              // 与按渠道视图一致：破坏性只靠红字表达，不铺底色
              className={
                row.enabled ? 'text-danger-text hover:text-danger-text' : 'hover:bg-muted'
              }
              icon={Power}
              // 有任意一行在切换时就整体禁用，避免并发请求把状态写串
              disabled={!writable || togglingId !== null}
              onClick={() => void toggleEnabled(row)}
            >
              {row.enabled ? '停用商品' : '启用商品'}
            </ActionButton>
          </div>
        ),
      },
    ],
    [channelNameById, healthByModelId, loading, onEditModel, onOpenChannel, togglingId, writable],
  );

  const channelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.channelId, row.channelName || channelNameById.get(row.channelId) || '');
    for (const item of channels) if (!map.has(item.id)) map.set(item.id, item.name);
    return [...map.entries()].map(([value, label]) => ({ value, label: label || value }));
  }, [rows, channels, channelNameById]);

  return (
    <div className="flex flex-col gap-3">
      <ProductStatusStrip
        counts={statusCounts}
        active={status}
        onChange={(next) => updateFilter(() => setStatus(next))}
      />
      <FilterBar className="mb-0">
        <ClearableField
          ariaLabel="搜索商品"
          value={keyword}
          onChange={(value) => updateFilter(() => setKeyword(value))}
          placeholder="商品编号 / 名称 / 供应商"
          className="w-64"
        />
        <SelectField
          ariaLabel="商品类型"
          value={capability}
          onChange={(value) => updateFilter(() => setCapability(value))}
          options={CAPABILITY_OPTIONS}
          clearLabel="全部类型"
          allowClear
          className="w-32"
        />
        <SelectField
          ariaLabel="商品状态"
          value={status === 'all' ? undefined : status}
          onChange={(value) => updateFilter(() => setStatus((value as AllModelsStatusFilter) ?? 'all'))}
          options={ALL_MODELS_STATUS_OPTIONS.filter((item) => item.value !== 'all')}
          // 触发器与复位项写同一句「全部状态」，与其它页一致：五个下拉并排时
          // 只写「全部」分不清这一格管的是状态还是类型
          clearLabel="全部状态"
          allowClear
          className="w-40"
        />
        <SelectField
          ariaLabel="所属供应商"
          value={channelFilter}
          onChange={(value) => updateFilter(() => setChannelFilter(value))}
          options={channelOptions}
          clearLabel="全部供应商"
          allowClear
          className="w-40"
        />
        <FilterActions>
          <span className="text-xs tabular-nums text-muted-foreground">
            {loading ? '读取中…' : `${filtered.length} 个商品 · ${availableCount} 个可用`}
          </span>
          <ActionButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setKeyword('');
              setCapability(undefined);
              setStatus('all');
              setChannelFilter(undefined);
              setPage(1);
            }}
          >
            重置
          </ActionButton>
        </FilterActions>
      </FilterBar>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            已选 {selectedIds.length} 个商品
          </span>
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
          {batchBusy && (
            <span className="text-xs text-muted-foreground">处理中…</span>
          )}
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
        minWidth={1240}
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
