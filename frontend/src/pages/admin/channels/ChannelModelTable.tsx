import { useMemo, useState } from 'react';
import {
  Copy,
  ListOrdered,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  AdminDataTable,
  AppliedFilters,
  ActionButton,
  ClearableField,
  Descriptions,
  FilterActions,
  FilterBar,
  HelpTip,
  Panel,
  SelectField,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { ChannelModelCapabilityTag } from './ChannelModelCapabilityTag';
import { ChannelModelCostSummary, ChannelModelHealthCell } from './ChannelModelHealthCell';
import { CAPABILITY_OPTIONS, PAGE_SIZE, STATUS_FILTER_OPTIONS } from './constants';
import type {
  AdminChannelModelView,
  ChannelModelHealthRowView,
  ProtocolTestResultView,
} from '../../../types/model';

interface ChannelModelTableProps {
  models: AdminChannelModelView[] | null;
  loading: boolean;
  error: string | null;
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
 * 渠道模型清单：本地检索 / 分页 + 行操作 + 最近一次测试结果。
 *
 * 与「全部模型」视图同一套列语义（模型 / 能力 / 稳定性 / 协议 / 成本售价 /
 * 版本 / 状态 / 操作），差别只在没有「渠道」列 —— 这里每行都属于同一条渠道。
 * 成本与售价并列保留：调价前要能一眼看出加价空间。
 */
export function ChannelModelTable({
  models,
  loading,
  error,
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
  /** 清单检索：与「全部模型」视图同一套口径（关键字 / 能力 / 状态） */
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
      if (statusFilter === 'enabled' && !model.enabled) return false;
      if (statusFilter === 'disabled' && model.enabled) return false;
      if (statusFilter === 'unpriced' && model.priceConfigured) return false;
      return true;
    });
  }, [models, keyword, capabilityFilter, statusFilter]);

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
      title: '模型',
      width: 156,
      cellTitle: (model) => model.modelKey,
      render: (model) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[12px] text-foreground">{model.modelKey}</span>
            {/* 价格版本放在这里而不是单独一列：详情区宽度有限，v7 这类单值列不值 80px */}
            <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">v{model.priceVersion}</span>
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {/* 图标是 C 端选择器的视觉标识，后台必须能看到「运营配的是什么」 */}
            {model.icon ? `${model.icon} ` : ''}
            {model.displayName || '未命名'}
            {model.providerModelKey && model.providerModelKey !== model.modelKey
              ? ` · 上游 ${model.providerModelKey}`
              : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'capability',
      title: '能力',
      width: 76,
      render: (model) => <ChannelModelCapabilityTag capability={model.capability} />,
    },
    {
      key: 'health',
      title: '稳定性（24h）',
      width: 104,
      render: (model) => (
        <ChannelModelHealthCell health={healthById.get(model.id)} loading={healthLoading} />
      ),
    },
    {
      key: 'protocol',
      title: '请求协议',
      width: 92,
      cellTitle: (model) => model.protocol,
      render: (model) =>
        model.protocol ? (
          <span className="block truncate font-mono text-[12px] text-muted-foreground">{model.protocol}</span>
        ) : (
          <StatusTag status="unset" tone="warn" label="待配置" />
        ),
    },
    {
      key: 'price',
      title: '成本价 / 销售价',
      width: 184,
      render: (model) => <ChannelModelCostSummary model={model} tiers={model.priceTiers} />,
    },
    {
      key: 'status',
      title: '状态',
      width: 76,
      /*
       * 一个模型只给一个状态：与「全部模型」视图同一套优先级（停用 > 未定价 > 启用）。
       * 原先「已启用 + 已定价」两枚绿标并排，行里出现两行绿色胶囊，反而看不出
       * 哪一个是需要处理的问题；正常态（已启用且已定价）不需要额外标记。
       */
      render: (model) => {
        if (!model.enabled) {
          return <StatusTag status="channel-model-disabled" tone="muted" label="已停用" />;
        }
        if (!model.priceConfigured) {
          return (
            <HelpTip tip="没有任何已配置的价格档：该模型不会被报价，也不应被线路选用">
              <StatusTag status="unpriced" tone="warn" label="未定价" />
            </HelpTip>
          );
        }
        return <StatusTag status="channel-model-enabled" tone="success" label="已启用" />;
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 320,
      fixed: 'right',
      /*
       * 每个动作同时展示图标和文案，降低仅靠图标猜含义的成本。
       * 操作列固定右侧，横向空间不足时表格内部滚动，不挤压模型与价格列。
       */
      render: (model) => (
        <div className="flex items-center justify-end gap-1">
          <ActionButton
            variant="secondary"
            size="xs"
            icon={Pencil}
            ariaLabel={`编辑模型 ${model.modelKey}`}
            disabled={!writable}
            onClick={() => onEdit(model)}
          >
            编辑
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Zap}
            ariaLabel={`测试模型 ${model.modelKey}`}
            disabled={testing || !canTest}
            onClick={() => onTest(model)}
          >
            {testing ? '测试中' : '测试'}
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            className={model.enabled ? 'text-danger-text hover:text-danger-text' : undefined}
            icon={Power}
            ariaLabel={`${model.enabled ? '停用' : '启用'}模型 ${model.modelKey}`}
            disabled={!writable}
            onClick={() => onToggle(model, !model.enabled)}
          >
            {model.enabled ? '停用' : '启用'}
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={Copy}
            ariaLabel={`复制模型 ${model.modelKey}`}
            disabled={!writable}
            onClick={() => onCopy(model)}
          >
            复制
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            className="text-danger-text hover:text-danger-text"
            icon={Trash2}
            ariaLabel={`删除模型 ${model.modelKey}`}
            disabled={!writable}
            onClick={() => onDelete(model)}
          >
            删除
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      {/*
       * 这里不再套 `Panel`：外层渠道详情已经是带边框的卡片，再套一层卡片
       * 会形成「卡片里再开一张卡片 + 筛选框」三级边框。分区改用标题 + 发丝线。
       */}
      <section className="flex flex-col gap-3" aria-labelledby="admin-model-list-title">
        <div className="flex flex-wrap items-start gap-3 border-b border-border pb-3">
          <div className="min-w-0 flex-1">
            <h3 id="admin-model-list-title" className="text-sm font-semibold text-foreground">
              模型清单（{(models ?? []).length}）
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {writable
                ? '停用后的模型不会进入路由，但历史账单与调用记录仍保留'
                : '当前账号只有渠道模型读权限'}
            </p>
          </div>
          {/* 模型级入口跟着清单位置走：原先在详情顶部单独占一行，页面会被拉出一条空白工具条 */}
          <div className="flex shrink-0 items-center gap-2">
            <ActionButton
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              disabled={fetching || !writable}
              onClick={onFetchUpstream}
            >
              {fetching ? '拉取中…' : '拉取上游目录'}
            </ActionButton>
            <ActionButton
              variant="default"
              size="sm"
              icon={Plus}
              disabled={!writable}
              onClick={onOpenCreate}
            >
              新建模型
            </ActionButton>
          </div>
        </div>

        <FilterBar className="mb-0 rounded-lg border-0 bg-muted/60">
          <ClearableField
            ariaLabel="搜索模型"
            value={keyword}
            onChange={(value) => {
              setKeyword(value);
              setPage(1);
            }}
            placeholder="搜索模型标识、显示名或上游键"
            className="w-64"
          />
          <SelectField
            ariaLabel="模型能力"
            value={capabilityFilter}
            onChange={(value) => {
              setCapabilityFilter(value);
              setPage(1);
            }}
            options={CAPABILITY_OPTIONS}
            placeholder="全部能力"
            clearLabel="全部能力"
            allowClear
            className="w-32"
          />
          <SelectField
            ariaLabel="模型状态"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={STATUS_FILTER_OPTIONS}
            placeholder="全部状态"
            clearLabel="全部状态"
            allowClear
            className="w-32"
          />
          <FilterActions>
            <ActionButton
              variant="secondary"
              size="xs"
              icon={ListOrdered}
              disabled={!writable}
              onClick={onOpenOrder}
            >
              排序
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="xs"
              icon={Trash2}
              disabled={!writable || selectedIds.length === 0}
              onClick={onOpenBatchDelete}
            >
              {selectedIds.length > 0 ? `批量删除（${selectedIds.length}）` : '批量删除'}
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="xs"
              icon={TrendingUp}
              disabled={!writable || selectedIds.length === 0}
              onClick={onOpenReprice}
            >
              {selectedIds.length > 0 ? `统一调价（${selectedIds.length}）` : '统一调价'}
            </ActionButton>
            <ActionButton variant="secondary" size="xs" disabled={!hasFilters} onClick={resetFilters}>
              重置
            </ActionButton>
          </FilterActions>
          <AppliedFilters
            items={[
              ...(keyword.trim()
                ? [
                    {
                      key: 'keyword',
                      label: `搜索：${keyword.trim()}`,
                      onClear: () => {
                        setKeyword('');
                        setPage(1);
                      },
                    },
                  ]
                : []),
              ...(capabilityFilter
                ? [
                    {
                      key: 'capability',
                      label: `能力：${
                        CAPABILITY_OPTIONS.find((item) => item.value === capabilityFilter)?.label ??
                        capabilityFilter
                      }`,
                      onClear: () => {
                        setCapabilityFilter(undefined);
                        setPage(1);
                      },
                    },
                  ]
                : []),
              ...(statusFilter
                ? [
                    {
                      key: 'status',
                      label: `状态：${
                        STATUS_FILTER_OPTIONS.find((item) => item.value === statusFilter)?.label ??
                        statusFilter
                      }`,
                      onClear: () => {
                        setStatusFilter(undefined);
                        setPage(1);
                      },
                    },
                  ]
                : []),
            ]}
            onClearAll={resetFilters}
          />
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
          rowSelectLabel={(model) => `选择模型 ${model.modelKey}`}
          emptyText={
            hasFilters
              ? '没有匹配的模型。调整搜索或筛选条件后重试。'
              : '该渠道还没有模型。可以「拉取上游目录」批量导入，或手动新建。'
          }
          density="compact"
          minWidth={1104}
          fixedLayout
          pagination={{
            current: currentPage,
            pageSize: PAGE_SIZE,
            total: filteredModels.length,
            onChange: (nextPage) => setPage(nextPage),
            unit: '个模型',
          }}
        />
      </section>

      {testResult && (
        <Panel title="最近一次测试结果" note={`调用记录 ${testResult.logId || '—'}（非计费）`}>
          <Descriptions
            columns={2}
            items={[
              {
                label: '结果',
                value: (
                  <StatusTag
                    status={testResult.status}
                    tone={testResult.status === 'succeeded' ? 'success' : 'danger'}
                    label={
                      testResult.status === 'succeeded'
                        ? '成功'
                        : testResult.status === 'pending'
                          ? '未完成'
                          : '失败'
                    }
                  />
                ),
              },
              { label: '耗时', value: `${testResult.durationMs}ms` },
              { label: 'HTTP', value: String(testResult.request?.path ?? '') },
              { label: '错误', value: testResult.error || testResult.message || '—' },
              {
                label: '产出',
                value: `${testResult.result?.images ?? 0} 图 / ${testResult.result?.videos ?? 0} 视频 / ${testResult.result?.text ? '有文本' : '无文本'}`,
              },
            ]}
          />
          {testResult.responsePreview && (
            <pre className="mt-3 max-h-[200px] overflow-auto rounded-lg bg-muted p-3 font-mono text-[12px] text-muted-foreground">
              {testResult.responsePreview}
            </pre>
          )}
        </Panel>
      )}
    </>
  );
}
