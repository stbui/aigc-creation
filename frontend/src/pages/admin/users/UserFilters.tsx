import {
  ActionButton,
  AppliedFilters,
  ClearableField,
  DateRangeField,
  FilterActions,
  FilterBar,
  SelectField,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { MEMBERSHIP_OPTIONS, ROLE_OPTIONS, SEGMENT_OPTIONS, STATUS_OPTIONS } from './constants';
import type {
  AdminUserMembershipFilter,
  AdminUserRole,
  AdminUserSegment,
  AdminUserStatus,
} from './types';

interface UserFiltersProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  role?: AdminUserRole;
  onRoleChange: (value: AdminUserRole | undefined) => void;
  status?: AdminUserStatus;
  onStatusChange: (value: AdminUserStatus | undefined) => void;
  from: string;
  to: string;
  onDateRangeChange: (range: { from: string; to: string }) => void;
  segment?: AdminUserSegment;
  onSegmentChange: (value: AdminUserSegment | undefined) => void;
  membership?: AdminUserMembershipFilter;
  onMembershipChange: (value: AdminUserMembershipFilter | undefined) => void;
  appliedChips: AppliedFilter[];
  onApply: () => void;
  onReset: () => void;
}

/** 用户列表的筛选与排序工具栏。只负责展示和转发用户操作。 */
export function UserFilters({
  keyword,
  onKeywordChange,
  role,
  onRoleChange,
  status,
  onStatusChange,
  from,
  to,
  onDateRangeChange,
  segment,
  onSegmentChange,
  membership,
  onMembershipChange,
  appliedChips,
  onApply,
  onReset,
}: UserFiltersProps) {
  return (
    <>
      <FilterBar>
        {/*
         * 六个条件原宽度合计 1160px，比 1440 视口下的内容区还宽 4px，
         * 于是「查询 / 重置」被挤到第二行、独占一整行。这里只压紧本页的
         * 两个宽度档位（不动 FilterBar / FilterActions 共用件），把动作收回
         * 第一行；其余后台页的形态不受影响。
         */}
        <ClearableField
          className="w-full sm:w-56"
          ariaLabel="按关键词搜索用户"
          placeholder="邮箱 / 昵称 / 手机号 / 用户 ID"
          value={keyword}
          onChange={onKeywordChange}
          onEnter={onApply}
        />
        <SelectField
          className="min-w-0 flex-1 sm:w-28 sm:flex-none"
          ariaLabel="按角色筛选"
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
          className="min-w-0 flex-1 sm:w-28 sm:flex-none"
          ariaLabel="按状态筛选"
          allowClear
          clearLabel="全部状态"
          value={status}
          onChange={(value) => {
            const next = STATUS_OPTIONS.find((option) => option.value === value)?.value;
            onStatusChange(next);
          }}
          options={STATUS_OPTIONS}
        />
        <SelectField
          className="min-w-0 flex-1 sm:w-28 sm:flex-none"
          ariaLabel="按运营分群筛选"
          allowClear
          clearLabel="全部分群"
          value={segment}
          onChange={(value) => {
            const next = SEGMENT_OPTIONS.find((option) => option.value === value)?.value;
            onSegmentChange(next as AdminUserSegment | undefined);
          }}
          options={SEGMENT_OPTIONS}
        />
        <SelectField
          className="min-w-0 flex-1 sm:w-28 sm:flex-none"
          ariaLabel="按会员状态筛选"
          allowClear
          clearLabel="全部会员"
          value={membership}
          onChange={(value) => {
            const next = MEMBERSHIP_OPTIONS.find(
              (option) => option.value === value,
            )?.value;
            onMembershipChange(next as AdminUserMembershipFilter | undefined);
          }}
          options={MEMBERSHIP_OPTIONS}
        />
        <DateRangeField
          className="sm:w-52"
          ariaLabel="按注册时间筛选"
          from={from}
          to={to}
          onChange={onDateRangeChange}
        />
        {/* 动作按钮一律右对齐：与其余 30 处筛选栏同一横向位置，换行时也贴右端 */}
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
    </>
  );
}
