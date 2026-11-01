/**
 * 后台数据表出口（shadcn 实现）。
 *
 * 29 张表的调用点从这里取 `AdminDataTable` / `AdminColumn`。2026-11-01 整站
 * 换 shadcn 时保持**签名不变、实现指向 `admin-ui/shadcn/kit/table`** ——
 * 排序、批量上限 100、固定操作列、行展开、分页与密度等行为逐条照搬，
 * 只把渲染换成 shadcn 的表格标记与令牌。
 */
export { AdminDataTable } from '../shadcn/kit/table';
export type { AdminColumn, AdminDataTableProps } from '../shadcn/kit/table';
