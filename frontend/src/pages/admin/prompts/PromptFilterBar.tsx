import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from './components';
import { ENABLED_OPTIONS, MODALITY_OPTIONS } from './constants';

interface PromptFilterBarProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  category: string | undefined;
  onCategoryChange: (value: string | undefined) => void;
  categories: string[];
  modality: string | undefined;
  onModalityChange: (value: string | undefined) => void;
  enabled: string | undefined;
  onEnabledChange: (value: string | undefined) => void;
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}

/** 提示词筛选条：只同步已生效的筛选，分页不进地址栏。 */
export function PromptFilterBar({
  keyword,
  onKeywordChange,
  category,
  onCategoryChange,
  categories,
  modality,
  onModalityChange,
  enabled,
  onEnabledChange,
  appliedChips,
  onApply,
  onReset,
}: PromptFilterBarProps) {
  const categoryOptions = categories.map((item) => ({ value: item, label: item }));

  return (
    <FilterBar>
      <ClearableField
        className="w-56"
        ariaLabel="按提示词标题或内容搜索"
        placeholder="标题 / 内容 / 标签"
        value={keyword}
        onChange={onKeywordChange}
        onEnter={onApply}
      />
      <SelectField
        className="w-36"
        ariaLabel="按分类筛选"
        clearLabel="全部分类"
        allowClear
        value={category}
        onChange={onCategoryChange}
        options={categoryOptions}
      />
      <SelectField
        className="w-32"
        ariaLabel="按适用模态筛选"
        clearLabel="全部模态"
        allowClear
        value={modality}
        onChange={onModalityChange}
        options={MODALITY_OPTIONS}
      />
      <SelectField
        className="w-32"
        ariaLabel="按启用状态筛选"
        clearLabel="全部状态"
        allowClear
        value={enabled}
        onChange={onEnabledChange}
        options={ENABLED_OPTIONS}
      />
      <FilterActions>
        <ActionButton variant="default" onClick={onApply}>
          查询
        </ActionButton>
        <ActionButton variant="secondary" onClick={onReset}>
          重置
        </ActionButton>
      </FilterActions>
      <AppliedFilters items={appliedChips} onClearAll={onReset} />
    </FilterBar>
  );
}
