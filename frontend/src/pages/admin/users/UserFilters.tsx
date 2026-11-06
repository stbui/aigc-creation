import {
  ActionButton,
  ExportCsvButton,
  AppliedFilters,
  ClearableField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { ROLE_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS } from './constants';
import type { AdminUserRole, AdminUserStatus } from './types';

interface UserFiltersProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  role?: AdminUserRole;
  onRoleChange: (value: AdminUserRole | undefined) => void;
  status?: AdminUserStatus;
  onStatusChange: (value: AdminUserStatus | undefined) => void;
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
  sort: string;
  onSortChange: (value: string) => void;
  canExport: boolean;
  exporting: boolean;
  onExport: () => void;
}

/** 用户列表的筛选与排序工具栏。只负责展示和转发用户操作。 */
export function UserFilters({
  keyword,
  onKeywordChange,
  role,
  onRoleChange,
  status,
  onStatusChange,
  appliedChips,
  onApply,
  onReset,
  sort,
  onSortChange,
  canExport,
  exporting,
  onExport,
}: UserFiltersProps) {
  return (
    <>
      <FilterBar className="mb-2">
        <ClearableField
          className="w-full sm:w-64"
          ariaLabel="按邮箱关键词搜索"
          placeholder="输入邮箱关键词"
          value={keyword}
          onChange={onKeywordChange}
          onEnter={onApply}
        />
        <SelectField
          className="min-w-0 flex-1 sm:w-32 sm:flex-none"
          ariaLabel="按角色筛选"
          placeholder="角色"
          allowClear
          clearLabel="全部角色"
          value={role}
          onChange={(value) => {
            const next = ROLE_OPTIONS.find((option) => option.value === value)?.value;
            onRoleChange(next);
          }}
          options={ROLE_OPTIONS}
        />
        <SelectField
          className="min-w-0 flex-1 sm:w-32 sm:flex-none"
          ariaLabel="按状态筛选"
          placeholder="状态"
          allowClear
          clearLabel="全部状态"
          value={status}
          onChange={(value) => {
            const next = STATUS_OPTIONS.find((option) => option.value === value)?.value;
            onStatusChange(next);
          }}
          options={STATUS_OPTIONS}
        />
        <FilterActions className="basis-full justify-end sm:basis-auto">
          <ActionButton variant="default" onClick={onApply}>
            查询
          </ActionButton>
          <ActionButton variant="secondary" onClick={onReset}>
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedChips} onClearAll={onReset} />
      </FilterBar>

      <div className="mb-2.5 flex flex-wrap items-center justify-end gap-2 border-b border-border pb-2">
        <span className="text-xs text-muted-foreground">排序</span>
        <SelectField
          className="w-32"
          ariaLabel="用户排序"
          value={sort}
          onChange={(value) => {
            if (value) onSortChange(value);
          }}
          options={SORT_OPTIONS}
        />
        {canExport && (
          <ExportCsvButton
            exporting={exporting}
            onExport={onExport}
            ariaLabel={exporting ? '正在导出用户 CSV' : '导出用户 CSV'}
          />
        )}
      </div>
    </>
  );
}
