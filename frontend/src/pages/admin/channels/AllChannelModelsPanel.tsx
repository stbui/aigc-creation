import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Power } from 'lucide-react';
import { adminChannelModelsApi, adminChannelsApi, fetchChannelHealth } from './api';
import {
  AdminDataTable,
  StaleError,
  ActionButton,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  StatusTag,
  type AdminColumn,
} from './components';
import { useConfirm, useToast, useAdminUrlFilterSync } from './hooks';
import { ChannelModelCostSummary, ChannelModelHealthCell } from './ChannelModelHealthCell';
import {
  ALL_MODELS_PAGE_SIZE,
  ALL_MODELS_STATUS_OPTIONS,
  CAPABILITY_OPTIONS,
  type AllModelsStatusFilter,
} from './constants';
import type {
  AdminChannelModelListItem,
  ChannelModelHealthRowView,
  ChannelOrderItemView,
} from '../../../types/model';

/**
 * 跨渠道「全部模型」视图。
 *
 * ## 为什么要这个视图
 *
 * 渠道工作台是「按渠道」组织的：看到某条线不对，要先知道它在哪个渠道，
 * 再选中那条渠道才能看价格与健康。但排障时的第一个问题往往是「**哪家**的
 * 模型在挂」—— 跨渠道看才答得上来。参考实现也把它做成与「按渠道」并列的
 * 第二个视图，而不是藏在单条渠道的详情里。
 *
 * ## 筛选口径
 *
 * · **状态**分五档：全部 / 启用 / 停用 / 不健康 / 未定价。
 *   「启用」= 模型自身启用 **且** 所属渠道启用（两者都为真才进路由）；
 *   「停用」= 其一不满足；
 *   「不健康」= 24h 成功率低于 80%（**无样本不算不健康** ——
 *   「没调用过」与「在挂」是两件事，混在一起会让刚上线的线全部标红）；
 *   「未定价」= 没有任何已配置价格档（补价工作队列）。
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
  onChanged,
  onOpenChannel,
  onEditModel,
}: {
  writable: boolean;
  onChanged: () => void;
  /** 点渠道名跳回「按渠道」视图并选中该渠道；不传则渠道名只是文本 */
  onOpenChannel?: (channelId: string) => void;
  /** 点「编辑」跳回该渠道并直接打开这条模型的编辑器 */
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
        const usable = item.enabled && item.channelEnabled;
        if (status === 'enabled' && !usable) return false;
        if (status === 'disabled' && usable) return false;
        if (status === 'unhealthy') {
          const stats = healthByModelId.get(item.id);
          const rate = stats?.windows.day.successRate;
          // 无样本不算不健康
          if (rate === null || rate === undefined || rate >= UNHEALTHY_RATE) return false;
        }
        // 未定价：模型存在但没有任何可用价格档 —— 补价工作队列
        if (status === 'unpriced' && item.priceConfigured) return false;
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
      toast.error(e instanceof Error ? e.message : '更新模型状态失败');
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
    const confirmed = await confirm({
      title: `停用 ${item.channelName || channelNameById.get(item.channelId) || '该渠道'} 的 ${item.displayName || item.modelKey}？`,
      description:
        '停用后新任务不再使用这个渠道的该模型，引用它的前台模型会切换到其他可用线路；配置保留，可随时重新启用。',
      confirmText: '确认停用',
      danger: true,
    });
    if (confirmed === null) return;
    await applyEnabled(item, false);
  };

  /** 任一筛选生效时，空表要区分「筛没了」与「本来就没有」 */
  const hasFilters = Boolean(keyword.trim() || capability || status !== 'all' || channelFilter);

  /** 筛选变化一律回到第 1 页：停在第 5 页筛选出 3 条会是一张空表 */
  const updateFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const enabledCount = filtered.filter((item) => item.enabled && item.channelEnabled).length;

  const columns: Array<AdminColumn<AdminChannelModelListItem>> = useMemo(
    () => [
      {
        key: 'model',
        title: '模型',
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
        title: '渠道',
        width: 160,
        render: (row) => {
          const name = row.channelName || channelNameById.get(row.channelId) || '—';
          return (
            <div className="min-w-0">
              {/* 排障动线：在这看到某条线不对，一步跳回它所属的渠道去改 */}
              {onOpenChannel ? (
                <button
                  type="button"
                  className="block max-w-full truncate text-brand hover:underline"
                  title="在渠道中查看"
                  onClick={() => onOpenChannel(row.channelId)}
                >
                  {name}
                </button>
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
        title: '能力',
        width: 76,
        render: (row) => (
          <StatusTag
            status="capability"
            tone="brand"
            label={CAPABILITY_OPTIONS.find((item) => item.value === row.capability)?.label ?? row.capability}
          />
        ),
      },
      {
        key: 'health',
        title: '稳定性（24h）',
        width: 160,
        render: (row) => (
          <ChannelModelHealthCell health={healthByModelId.get(row.id)} loading={loading} />
        ),
      },
      {
        key: 'cost',
        title: '成本价 / 销售价',
        width: 300,
        render: (row) => <ChannelModelCostSummary model={row} tiers={row.priceTiers} />,
      },
      {
        key: 'status',
        title: '状态',
        width: 100,
        render: (row) => {
          if (!row.enabled) return <StatusTag status="disabled" tone="muted" label="停用" />;
          if (!row.channelEnabled) return <StatusTag status="channel-disabled" tone="warn" label="渠道停用" />;
          if (!row.priceConfigured) return <StatusTag status="unpriced" tone="warn" label="未定价" />;
          return <StatusTag status="enabled" tone="success" label="启用" />;
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
                size="xs"
                icon={Pencil}
                disabled={!writable}
                onClick={() => onEditModel(row.channelId, row.id)}
              >
                编辑
              </ActionButton>
            )}
            <ActionButton
              variant="ghost"
              size="xs"
              // 与按渠道视图一致：破坏性只靠红字表达，不铺底色
              className={
                row.enabled ? 'text-danger-text hover:text-danger-text' : 'hover:bg-muted'
              }
              icon={Power}
              // 有任意一行在切换时就整体禁用，避免并发请求把状态写串
              disabled={!writable || togglingId !== null}
              onClick={() => void toggleEnabled(row)}
            >
              {row.enabled ? '停用' : '启用'}
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
      <FilterBar>
        <ClearableField
          ariaLabel="搜索模型"
          value={keyword}
          onChange={(value) => updateFilter(() => setKeyword(value))}
          placeholder="搜索模型标识、显示名或渠道"
          className="w-64"
        />
        <SelectField
          ariaLabel="模型能力"
          value={capability}
          onChange={(value) => updateFilter(() => setCapability(value))}
          options={CAPABILITY_OPTIONS}
          placeholder="全部能力"
          clearLabel="全部能力"
          allowClear
          className="w-32"
        />
        <SelectField
          ariaLabel="模型状态"
          value={status === 'all' ? undefined : status}
          onChange={(value) => updateFilter(() => setStatus((value as AllModelsStatusFilter) ?? 'all'))}
          options={ALL_MODELS_STATUS_OPTIONS.filter((item) => item.value !== 'all')}
          placeholder="全部状态"
          // 复位项就叫「全部」：它是「不按状态筛」的通用说法，各页统一，
          // 运营不用逐页记这一格叫「全部状态」还是「全部模型」。
          clearLabel="全部"
          allowClear
          className="w-32"
        />
        <SelectField
          ariaLabel="所属渠道"
          value={channelFilter}
          onChange={(value) => updateFilter(() => setChannelFilter(value))}
          options={channelOptions}
          placeholder="全部渠道"
          clearLabel="全部渠道"
          allowClear
          className="w-40"
        />
        <FilterActions>
          <span className="text-xs tabular-nums text-muted-foreground">
            {loading ? '读取中…' : `${filtered.length} 个模型 · ${enabledCount} 个可用`}
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

      {error && rows.length === 0 && <StaleError error={error} onRetry={() => void load()} />}

      <AdminDataTable<AdminChannelModelListItem>
        rows={paged}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyText={
          hasFilters
            ? '当前筛选下没有匹配的模型，清除筛选后再看。'
            : '还没有渠道模型。在渠道工作台的「模型」里导入或新建后，这里会列出全部线路。'
        }
        minWidth={1080}
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
