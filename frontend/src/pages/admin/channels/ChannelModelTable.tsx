import { useMemo, useState } from 'react';
import { Copy, ListOrdered, Pencil, Power, Trash2, TrendingUp, Zap } from 'lucide-react';
import {
  AdminDataTable,
  AppliedFilters,
  Button,
  Descriptions,
  FilterActions,
  FilterBar,
  HoverTip,
  Panel,
  SelectBox,
  StatusTag,
  TextInput,
  type AdminColumn,
} from './components';
import { ChannelModelCostSummary, ChannelModelHealthCell } from './ChannelModelHealthCell';
import { CAPABILITY_OPTIONS, PAGE_SIZE, STATUS_FILTER_OPTIONS } from './modelDraft';
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
      width: 200,
      cellTitle: (model) => model.modelKey,
      render: (model) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[12px] text-text-primary">{model.modelKey}</span>
            {/* 价格版本放在这里而不是单独一列：详情区宽度有限，v7 这类单值列不值 80px */}
            <span className="shrink-0 tabular-nums text-[10px] text-text-placeholder">v{model.priceVersion}</span>
          </div>
          <div className="truncate text-[11px] text-text-tertiary">
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
      width: 56,
      render: (model) => (
        <StatusTag
          status="capability"
          tone="brand"
          label={
            CAPABILITY_OPTIONS.find((item) => item.value === model.capability)?.label ?? model.capability
          }
        />
      ),
    },
    {
      key: 'health',
      title: '稳定性（24h）',
      width: 150,
      render: (model) => (
        <ChannelModelHealthCell health={healthById.get(model.id)} loading={healthLoading} />
      ),
    },
    {
      key: 'protocol',
      title: '请求协议',
      width: 108,
      cellTitle: (model) => model.protocol,
      render: (model) =>
        model.protocol ? (
          <span className="font-mono text-[11px] text-text-secondary">{model.protocol}</span>
        ) : (
          <StatusTag status="unset" tone="warn" label="待配置" />
        ),
    },
    {
      key: 'price',
      title: '成本价 / 销售价',
      width: 200,
      render: (model) => <ChannelModelCostSummary model={model} tiers={model.priceTiers} />,
    },
    {
      key: 'status',
      title: '状态',
      width: 88,
      render: (model) => (
        <div className="flex flex-wrap items-center gap-1">
          {model.enabled ? (
            <StatusTag status="channel-model-enabled" tone="success" label="已启用" />
          ) : (
            <StatusTag status="channel-model-disabled" tone="muted" label="已停用" />
          )}
          {model.priceConfigured ? (
            <StatusTag status="priced" tone="success" label="已定价" />
          ) : (
            <HoverTip tip="没有任何已配置的价格档：该模型不会被报价，也不应被线路选用">
              <StatusTag status="unpriced" tone="warn" label="未定价" />
            </HoverTip>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (model) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            leadingIcon={Zap}
            disabled={testing}
            title="连通性测试"
            aria-label={`测试模型 ${model.modelKey}`}
            onClick={() => onTest(model)}
          />
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            leadingIcon={Pencil}
            disabled={!writable}
            title="编辑"
            aria-label={`编辑模型 ${model.modelKey}`}
            onClick={() => onEdit(model)}
          />
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            leadingIcon={Power}
            disabled={!writable}
            title={model.enabled ? '停用' : '启用'}
            aria-label={`${model.enabled ? '停用' : '启用'}模型 ${model.modelKey}`}
            onClick={() => onToggle(model, !model.enabled)}
          />
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            leadingIcon={Copy}
            disabled={!writable}
            title="复制模型"
            aria-label={`复制模型 ${model.modelKey}`}
            onClick={() => onCopy(model)}
          />
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            leadingIcon={Trash2}
            disabled={!writable}
            title="删除模型"
            aria-label={`删除模型 ${model.modelKey}`}
            onClick={() => onDelete(model)}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel
        title={`模型清单（${(models ?? []).length}）`}
        note={writable ? '停用后的模型不会进入路由，但历史账单与调用记录仍保留' : '当前账号只有渠道模型读权限'}
        extra={
          <>
            <Button
              variant="secondary"
              size="xs"
              leadingIcon={ListOrdered}
              disabled={!writable}
              onClick={onOpenOrder}
            >
              排序
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leadingIcon={Trash2}
              disabled={!writable || selectedIds.length === 0}
              onClick={onOpenBatchDelete}
            >
              {selectedIds.length > 0 ? `批量删除（${selectedIds.length}）` : '批量删除'}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leadingIcon={TrendingUp}
              disabled={!writable || selectedIds.length === 0}
              onClick={onOpenReprice}
            >
              {selectedIds.length > 0 ? `统一调价（${selectedIds.length}）` : '统一调价'}
            </Button>
          </>
        }
      >
        <FilterBar>
          <TextInput
            ariaLabel="搜索模型"
            value={keyword}
            onChange={(value) => {
              setKeyword(value);
              setPage(1);
            }}
            placeholder="搜索模型标识、显示名或上游键"
            allowClear
            className="min-w-[220px]"
          />
          <SelectBox
            ariaLabel="模型能力"
            value={capabilityFilter}
            onChange={(value) => {
              setCapabilityFilter(value);
              setPage(1);
            }}
            options={CAPABILITY_OPTIONS}
            placeholder="全部能力"
            allowClear
          />
          <SelectBox
            ariaLabel="模型状态"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={STATUS_FILTER_OPTIONS}
            placeholder="全部状态"
            allowClear
          />
          <FilterActions>
            <Button variant="secondary" size="small" disabled={!hasFilters} onClick={resetFilters}>
              重置
            </Button>
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
          minWidth={980}
          pagination={{
            current: currentPage,
            pageSize: PAGE_SIZE,
            total: filteredModels.length,
            onChange: (nextPage) => setPage(nextPage),
            unit: '个模型',
          }}
        />
      </Panel>

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
            <pre className="mt-3 max-h-[200px] overflow-auto rounded-lg bg-background-secondary-default p-3 font-mono text-[11px] text-text-secondary">
              {testResult.responsePreview}
            </pre>
          )}
        </Panel>
      )}
    </>
  );
}
