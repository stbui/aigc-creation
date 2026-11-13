import {
  ActionButton,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
} from '~/admin-ui/primitives';
import { ProductStatusStrip, type ProductStatusCounts } from './ProductStatusStrip';
import {
  ALL_MODELS_COMMERCE_OPTIONS,
  ALL_MODELS_STATUS_OPTIONS,
  CAPABILITY_OPTIONS,
  type AllModelsCommerceFilter,
  type AllModelsStatusFilter,
} from './constants';

interface Props {
  counts: ProductStatusCounts;
  status: AllModelsStatusFilter;
  keyword: string;
  capability?: string;
  channelFilter?: string;
  commerceFilter?: AllModelsCommerceFilter;
  channelOptions: Array<{ value: string; label: string }>;
  showCommerce: boolean;
  commerceReady: boolean;
  total: number;
  available: number;
  loading: boolean;
  onStatusChange: (next: AllModelsStatusFilter) => void;
  onKeywordChange: (next: string) => void;
  onCapabilityChange: (next: string | undefined) => void;
  onChannelChange: (next: string | undefined) => void;
  onCommerceChange: (next: AllModelsCommerceFilter | undefined) => void;
  onReset: () => void;
}

/**
 * 商品台账筛选条：状态条 + 五维筛选。
 *
 * 「商品状态」与「经营筛选」分开：前者是商品自身的可用性，后者是近 7 天
 * 经营结果。把「无调用」塞进状态下拉会把「能卖但还没卖」误标成配置问题。
 */
export function AllChannelModelsFilters({
  counts,
  status,
  keyword,
  capability,
  channelFilter,
  commerceFilter,
  channelOptions,
  showCommerce,
  commerceReady,
  total,
  available,
  loading,
  onStatusChange,
  onKeywordChange,
  onCapabilityChange,
  onChannelChange,
  onCommerceChange,
  onReset,
}: Props) {
  return (
    <>
      <ProductStatusStrip counts={counts} active={status} onChange={onStatusChange} />
      <FilterBar className="mb-0">
        <ClearableField
          ariaLabel="搜索商品"
          value={keyword}
          onChange={onKeywordChange}
          placeholder="商品编号 / 名称 / 供应商"
          className="w-56"
        />
        <SelectField
          ariaLabel="商品类型"
          value={capability}
          onChange={onCapabilityChange}
          options={CAPABILITY_OPTIONS}
          clearLabel="全部类型"
          allowClear
          className="w-28"
        />
        <SelectField
          ariaLabel="商品状态"
          value={status === 'all' ? undefined : status}
          onChange={(value) => onStatusChange((value as AllModelsStatusFilter) ?? 'all')}
          options={ALL_MODELS_STATUS_OPTIONS.filter((item) => item.value !== 'all')}
          clearLabel="全部状态"
          allowClear
          className="w-36"
        />
        <SelectField
          ariaLabel="所属供应商"
          value={channelFilter}
          onChange={onChannelChange}
          options={channelOptions}
          clearLabel="全部供应商"
          allowClear
          className="w-36"
        />
        {showCommerce && (
          <SelectField
            ariaLabel="经营筛选"
            value={commerceFilter}
            onChange={(value) => onCommerceChange((value as AllModelsCommerceFilter) ?? undefined)}
            options={ALL_MODELS_COMMERCE_OPTIONS}
            clearLabel="全部经营表现"
            allowClear
            disabled={!commerceReady}
            className="w-36"
          />
        )}
        <FilterActions>
          <span className="text-xs tabular-nums text-muted-foreground">
            {loading ? '读取中…' : `${total} 个商品 · ${available} 个可用`}
          </span>
          <ActionButton variant="secondary" size="sm" onClick={onReset}>
            重置
          </ActionButton>
        </FilterActions>
      </FilterBar>
    </>
  );
}
