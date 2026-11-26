/**
 * 用户管理模块的共享控件入口（按 `docs/design/standards/frontend-module-conventions.md`）。
 *
 * 只 re-export 来自 `~/components/admin` 的共享组件与常量；本模块自有业务组件
 * 由各文件直接 `./Xxx` 引用，不在此聚合（避免循环引用）。内部文件统一从本文件
 * 取共享控件，不直接连 `~/components`。
 */
export {
  BatchDeleteUsersDialog,
  BATCH_DELETE_LIMIT,
  BATCH_DELETE_CONFIRM,
} from '~/components/admin/BatchDeleteUsersDialog';

export { ActionButton, type AdminColumn, AdminDataTable, AdminPage, type AppliedFilter, AppliedFilters, BatchBar, ClearableField, Descriptions, DetailSection, Drawer, EmptyState, ExportCsvButton, FilePicker, FilterActions, FilterBar, FormField, ListError, Notice, Pagination, Panel, RefreshButton, Segmented, SelectField, SkeletonBody, StaleError, StatCards, StatusTag, TextAreaField, TextField } from '~/admin-ui/radar';