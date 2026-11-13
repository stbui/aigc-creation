import { useMemo } from 'react';
import { Pencil, Power } from 'lucide-react';
import {
  ActionButton,
  Button,
  RowMenu,
  StatusTag,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { ChannelModelCapabilityTag } from './ChannelModelCapabilityTag';
import { ProductConsumptionCell } from './ProductConsumptionCell';
import { ChannelModelCostSummary, ChannelModelHealthCell } from './ChannelModelHealthCell';
import { ModelCommerceMetricsCell } from './ModelCommerceMetricsCell';
import { PRODUCT_STATE_META, productStateOf } from './utils';
import type { ProductConsumptionState } from './useProductConsumption';
import type {
  AdminChannelModelListItem,
  ChannelModelHealthRowView,
  ModelCommerceProductView,
} from '../../../types/model';

export interface AllChannelModelsColumnOptions {
  channelNameById: Map<string, string>;
  healthByModelId: Map<string, ChannelModelHealthRowView>;
  commerceByModelId: Map<string, ModelCommerceProductView>;
  consumption: ProductConsumptionState;
  loading: boolean;
  commerceLoading: boolean;
  canTest: boolean;
  writable: boolean;
  togglingId: string | null;
  testingId: string | null;
  onOpenChannel?: (channelId: string) => void;
  onEditModel?: (channelId: string, modelId: string) => void;
  onToggle: (row: AdminChannelModelListItem) => void;
  onTest: (row: AdminChannelModelListItem) => void;
}

/**
 * 商品台账列定义。
 *
 * 宽度按 1440px 内容区（约 1146px）倒推：商品与供应商合并为一格，经营表现
 * 用 2×2 压缩，状态列始终可见，操作列固定右侧。新增信息优先放进已有格的
 * 第二行或 title，而不是继续加宽整张表。
 */
export function useAllChannelModelsColumns({
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
  onToggle,
  onTest,
}: AllChannelModelsColumnOptions): Array<AdminColumn<AdminChannelModelListItem>> {
  return useMemo(
    () => [
      {
        key: 'model',
        title: '商品 / 供应商',
        width: 205,
        render: (row) => {
          const name = row.displayName || row.modelKey;
          const channelName = row.channelName || channelNameById.get(row.channelId) || '—';
          return (
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground" title={name}>
                {row.icon ? `${row.icon} ` : ''}
                {name}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] leading-4 text-muted-foreground">
                <span className="truncate font-mono" title={row.modelKey}>
                  {row.modelKey}
                </span>
                <span aria-hidden>·</span>
                {onOpenChannel ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto min-w-0 justify-start overflow-hidden p-0 text-[12px] text-brand"
                    title="在供应商中查看"
                    onClick={() => onOpenChannel(row.channelId)}
                  >
                    <span className="truncate">{channelName}</span>
                    {!row.channelEnabled && <span className="shrink-0">（停用）</span>}
                  </Button>
                ) : (
                  <span className="truncate" title={channelName}>
                    {channelName}
                    {!row.channelEnabled ? '（停用）' : ''}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: 'capability',
        title: '类型',
        width: 64,
        render: (row) => <ChannelModelCapabilityTag capability={row.capability} />,
      },
      {
        key: 'consumption',
        title: '消费能力',
        width: 128,
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
        width: 108,
        render: (row) => (
          <ChannelModelHealthCell health={healthByModelId.get(row.id)} loading={loading} />
        ),
      },
      {
        key: 'commerce',
        title: '经营表现',
        width: 166,
        render: (row) => (
          <ModelCommerceMetricsCell
            commerce={commerceByModelId.get(row.id)}
            loading={commerceLoading}
          />
        ),
      },
      {
        key: 'cost',
        title: '售价',
        width: 170,
        render: (row) => <ChannelModelCostSummary model={row} tiers={row.priceTiers} saleOnly />,
      },
      {
        key: 'status',
        title: '状态',
        width: 84,
        render: (row) => {
          const state = productStateOf(row, row.channelEnabled);
          const meta = PRODUCT_STATE_META[state];
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
              className={
                row.enabled ? 'text-danger-text hover:text-danger-text' : 'hover:bg-muted'
              }
              icon={Power}
              disabled={!writable || togglingId !== null}
              onClick={() => onToggle(row)}
            >
              {row.enabled ? '停用商品' : '启用商品'}
            </ActionButton>
            {canTest && (
              <RowMenu
                label={`商品 ${row.modelKey} 更多操作`}
                items={[
                  {
                    key: 'test',
                    label: testingId === row.id ? '测试中…' : '测试连通',
                    disabled: testingId === row.id,
                    onSelect: () => onTest(row),
                  },
                ]}
              />
            )}
          </div>
        ),
      },
    ],
    [
      canTest,
      channelNameById,
      commerceByModelId,
      commerceLoading,
      consumption,
      healthByModelId,
      loading,
      onEditModel,
      onOpenChannel,
      onTest,
      onToggle,
      testingId,
      togglingId,
      writable,
    ],
  );
}
