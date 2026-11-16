/**
 * 订单管理的共享控件入口 —— 仅再导出外部共享件（按《后台模块拆分规范》§2）。
 */

export type { TagTone } from '~/components/admin/statusMeta';

export { ActionButton, type AdminColumn, AdminDataTable, AdminDrawer, AdminPage, type AppliedFilter, AppliedFilters, BatchBar, ClearableField, ConfirmDialog, ContextBanner, DateRangeField, Descriptions, DetailSection, ExportCsvButton, FilterActions, FilterBar, ModalDialog, Panel, RefreshButton, RowMenu, type RowMenuItem, SavedViewBar, SelectField, StaleError, StatusTag, TextField } from '~/admin-ui/radar';