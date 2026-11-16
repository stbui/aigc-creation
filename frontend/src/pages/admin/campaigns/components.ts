/**
 * 限时活动模块共享控件入口 —— 仅再导出外部共享件（按《后台模块拆分规范》§2）。
 */

export type { TagTone } from '~/components/admin/statusMeta';

export { ActionButton, type AdminColumn, AdminDataTable, AdminPage, type AppliedFilter, AppliedFilters, ClearableField, ConfirmDialog, ExportCsvButton, FilterActions, FilterBar, FormDrawer, FormField, Notice, Panel, RefreshButton, RowMenu, SelectField, StaleError, StatusTag, SwitchField, TextAreaField, TextField, ToneBadge } from '~/admin-ui/radar';