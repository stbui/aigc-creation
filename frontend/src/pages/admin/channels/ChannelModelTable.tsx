import { useMemo, useState } from 'react';
import { ListOrdered, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-react';
import {
  AdminDataTable,
  AppliedFilters,
  ActionButton,
  ClearableField,
  FilterActions,
  FilterBar,
  RowMenu,
  SelectField,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { ChannelModelCapabilityTag } from './ChannelModelCapabilityTag';
import { ChannelModelCostSummary, ChannelModelHealthCell } from './ChannelModelHealthCell';
import { ChannelModelTestResultPanel } from './ChannelModelTestResultPanel';
import { ProductConsumptionCell } from './ProductConsumptionCell';
import { PRODUCT_STATE_META, productStateOf } from './utils';
import { CAPABILITY_OPTIONS, PAGE_SIZE, STATUS_FILTER_OPTIONS } from './constants';
import type { ProductConsumptionState } from './useProductConsumption';
import type { AdminChannelModelView, ChannelModelHealthRowView, ProtocolTestResultView } from '../../../types/model';

interface ChannelModelTableProps {
  models: AdminChannelModelView[] | null;
  /** 所属渠道是否启用；渠道停用时模型自身即使启用也不会进入路由。 */
  channelEnabled?: boolean;
  loading: boolean;
  error: string | null;
  consumption: ProductConsumptionState;
  healthById: Map<string, ChannelModelHealthRowView>;
  healthLoading: boolean;
  selectedIds: string[];
  writable: boolean;
  /**
   * 是否可发起连通性测试（`channel.test` 权限）。
   *
   * 与 `writable`（`channel.model_write`）分开：测试只探测、不写配置，
   * 参考实现把它当独立权限点。只读排障角色（operator）有测试权但没有改价权，
   * 用 `writable` 门禁会把这条能力一起挡掉。
   */
  canTest?: boolean;
  testing: boolean;
  testResult: ProtocolTestResultView | null;
  onSelectedChange: (ids: string[]) => void;
  onRetry: () => void;
  onTest: (model: AdminChannelModelView) => void;
  onEdit: (model: AdminChannelModelView) => void;
  onToggle: (model: AdminChannelModelView, enabled: boolean) => void;
  onCopy: (model: AdminChannelModelView) => void;
  onDelete: (model: AdminChannelModelView) => void;
  onOpenOrder: () => void;
  onOpenBatchDelete: () => void;
  onOpenReprice: () => void;
  /** 新建模型 / 拉取上游目录：模型级入口，收进清单标题行，避免页面顶部长出一条孤立工具条 */
  onOpenCreate: () => void;
  onFetchUpstream: () => void;
  fetching: boolean;
}

/**
 * 供应商下的商品清单：本地检索 / 分页 + 行操作 + 最近一次测试结果。
 *
 * 与「商品台账」同一套列语义（商品 / 类型 / 消费能力 / 健康 / 售价 / 状态 /
 * 操作），差别只在没有「供应商」列 —— 这里每行都属于同一家供应商。
 * 成本与售价并列保留：调价前要能一眼看出加价空间。
 */
export function ChannelModelTable({
  models,
  channelEnabled = true,
  loading,
  error,
  consumption,
  healthById,
  healthLoading,
  selectedIds,
  writable,
  canTest = true,
  testing,
  testResult,
  onSelectedChange,
  onRetry,
  onTest,
  onEdit,
  onToggle,
  onCopy,
  onDelete,
  onOpenOrder,
  onOpenBatchDelete,
  onOpenReprice,
  onOpenCreate,
  onFetchUpstream,
  fetching,
}: ChannelModelTableProps) {
  /** 清单检索：与「商品台账」视图同一套口径（关键字 / 类型 / 状态） */
  const [keyword, setKeyword] = useState('');
  const [capabilityFilter, setCapabilityFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const filteredModels = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return (models ?? []).filter((model) => {
      if (
        query &&
        !`${model.modelKey} ${model.providerModelKey} ${model.displayName} ${model.channelLabel}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      if (capabilityFilter && model.capability !== capabilityFilter) return false;
      const state = productStateOf(model, channelEnabled);
      if (statusFilter === 'enabled' && state !== 'available') return false;
      if (statusFilter === 'disabled' && state !== 'disabled') return false;
      if (statusFilter === 'unpriced' && state !== 'unpriced') return false;
      if (statusFilter === 'unconfigured' && state !== 'unconfigured') return false;
      return true;
    });
  }, [models, keyword, capabilityFilter, statusFilter, channelEnabled]);

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedModels = useMemo(
    () => filteredModels.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredModels, currentPage],
  );
  const hasFilters = Boolean(keyword.trim() || capabilityFilter || statusFilter);

  const resetFilters = () => {
    setKeyword('');
    setCapabilityFilter(undefined);
    setStatusFilter(undefined);
    setPage(1);
  };

  const modelColumns: Array<AdminColumn<AdminChannelModelView>> = [
    {
      key: 'model',
      title: '商品',
      width: 200,
      cellTitle: (model) => `${model.modelKey} · ${model.protocol || '接入方式待配置'}`,
      render: (model) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] text-foreground">{model.modelKey}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {/* 图标是 C 端选择器的视觉标识，后台必须能看到「运营配的是什么」 */}
            {model.icon ? `${model.icon} ` : ''}
            {model.displayName || '未命名'}
            {model.providerModelKey && model.providerModelKey !== model.modelKey
              ? ` · 服务商 ${model.providerModelKey}`
              : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'capability',
      title: '类型',
      width: 76,
      render: (model) => <ChannelModelCapabilityTag capability={model.capability} />,
    },
    {
      key: 'consumption',
      title: '消费能力',
      width: 160,
      render: (model) => (
        <ProductConsumptionCell
          refs={consumption.byModelId.get(model.id)}
          loading={consumption.loading}
          available={consumption.available}
        />
      ),
    },
    {
      key: 'health',
      title: '健康',
      width: 104,
      render: (model) => <ChannelModelHealthCell health={healthById.get(model.id)} loading={healthLoading} />,
    },
    {
      key: 'price',
      title: '售价',
      width: 184,
      render: (model) => <ChannelModelCostSummary model={model} tiers={model.priceTiers} saleOnly />,
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      /*
       * 一个商品只给一个状态：与「商品台账」同一套优先级
       * （待配置 > 停用 > 待定价 > 可用）。供应商停用与商品停用都收敛成「已停用」，
       * 具体是谁停用放进悬停里 —— 列表上再并排两枚胶囊只会增加噪声。
       */
      render: (model) => {
        const state = productStateOf(model, channelEnabled);
        const meta = PRODUCT_STATE_META[state];
        const detail =
          state === 'disabled' && !channelEnabled
            ? '所属供应商已停用'
            : state === 'disabled'
              ? '商品已停用'
              : state === 'unpriced'
                ? '暂无有效售价：商品不会展示给用户，也无法被选用'
                : state === 'unconfigured'
                  ? '尚未声明模型类型或接入方式'
                  : undefined;
        return (
          <span title={detail}>
            <StatusTag status={`product-${state}`} tone={meta.tone} label={meta.label} />
          </span>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 132,
      fixed: 'right',
      render: (model) => (
        <div className="flex items-center justify-end gap-1">
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Pencil}
            ariaLabel={`编辑商品 ${model.modelKey}`}
            disabled={!writable}
            onClick={() => onEdit(model)}
          >
            编辑
          </ActionButton>
          <RowMenu
            label={`商品 ${model.modelKey} 更多操作`}
            items={[
              {
                key: 'test',
                label: testing ? '测试中…' : '测试连通',
                disabled: testing || !canTest,
                onSelect: () => onTest(model),
              },
              {
                key: 'copy',
                label: '复制商品',
                disabled: !writable,
                onSelect: () => onCopy(model),
              },
              {
                key: 'toggle',
                label: model.enabled ? '停用商品' : '启用商品',
                disabled: !writable,
                danger: model.enabled,
                onSelect: () => onToggle(model, !model.enabled),
              },
              {
                key: 'delete',
                label: '删除商品',
                disabled: !writable,
                danger: true,
                separator: true,
                onSelect: () => onDelete(model),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="admin-model-list-title">
        <div className="flex flex-wrap items-start gap-3 border-b border-border pb-3">
          <div className="min-w-0 flex-1">
            <h3 id="admin-model-list-title" className="text-sm font-semibold text-foreground">
              商品清单
            </h3>
            {!writable && <p className="mt-0.5 text-xs text-muted-foreground">当前账号仅可查看</p>}
          </div>
          {/* 模型级入口跟着清单位置走：原先在详情顶部单独占一行，页面会被拉出一条空白工具条 */}
          <ClearableField
            ariaLabel="搜索商品"
            value={keyword}
            onChange={(value) => {
              setKeyword(value);
              setPage(1);
            }}
            placeholder="搜索商品编号、名称或上游模型名"
            className="w-64"
          />
          <SelectField
            ariaLabel="商品类型"
            value={capabilityFilter}
            onChange={(value) => {
              setCapabilityFilter(value);
              setPage(1);
            }}
            options={CAPABILITY_OPTIONS}
            placeholder="全部类型"
            clearLabel="全部类型"
            allowClear
            className="w-32"
          />
          <SelectField
            ariaLabel="商品状态"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={STATUS_FILTER_OPTIONS}
            placeholder="全部状态"
            clearLabel="全部状态"
            allowClear
            className="w-36"
          />
          <ActionButton variant="secondary" size="xs" disabled={!hasFilters} onClick={resetFilters}>
            重置
          </ActionButton>
        </div>

        <FilterBar className="mb-0 rounded-lg border-0 bg-muted/60">
          <div className="flex shrink-0 items-center gap-2">
            <ActionButton variant="default" size="sm" icon={Plus} disabled={!writable} onClick={onOpenCreate}>
              新建商品
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              disabled={fetching || !writable}
              onClick={onFetchUpstream}
            >
              {fetching ? '同步中…' : '从供应商同步商品'}
            </ActionButton>

          </div>


          <FilterActions>
            {selectedIds.length > 0 && (
              <>
                <ActionButton
                  variant="secondary"
                  size="xs"
                  icon={TrendingUp}
                  disabled={!writable}
                  onClick={onOpenReprice}
                >
                  统一调价（{selectedIds.length}）
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  size="xs"
                  icon={Trash2}
                  disabled={!writable}
                  onClick={onOpenBatchDelete}
                >
                  批量删除（{selectedIds.length}）
                </ActionButton>
              </>
            )}
            <ActionButton
              variant="secondary"
              size="xs"
              icon={ListOrdered}
              disabled={!writable}
              onClick={onOpenOrder}
            >
              排序
            </ActionButton>
          </FilterActions>
        </FilterBar>

        <AdminDataTable<AdminChannelModelView>
          rows={pagedModels}
          columns={modelColumns}
          rowKey={(model) => model.id}
          loading={loading}
          error={(models ?? []).length === 0 ? error : null}
          onRetry={onRetry}
          selectable
          selected={selectedIds}
          onSelectedChange={onSelectedChange}
          rowSelectLabel={(model) => `选择商品 ${model.modelKey}`}
          emptyText={hasFilters ? '没有匹配的商品' : '暂无商品'}
          density="compact"
          minWidth={1040}
          fixedLayout
          pagination={{
            current: currentPage,
            pageSize: PAGE_SIZE,
            total: filteredModels.length,
            onChange: (nextPage) => setPage(nextPage),
            unit: '个商品',
          }}
        />
      </section>

      {testResult && <ChannelModelTestResultPanel testResult={testResult} />}
    </>
  );
}
