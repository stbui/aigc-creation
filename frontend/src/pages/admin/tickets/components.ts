/**
 * 工单模块的共享控件入口（按 `docs/design/standards/frontend-module-conventions.md`）。
 *
 * 只 re-export 来自 `~/components/admin` 的共享类型；内部文件统一从本文件取，
 * 不直接连 `~/components`。`constants.ts` 经本文件取 `TagTone`（符合 §3
 * `constants` → `components` 只取选项类型的单向依赖）。
 */
export type { TagTone } from '~/components/admin/statusMeta';

export { ActionButton, type AdminColumn, AdminDataTable, AdminPage, type AppliedFilter, AppliedFilters, Button, ClearableField, ConfirmDialog, ContextBanner, Descriptions, DetailSection, Drawer, EmptyState, ExportCsvButton, FilterActions, FilterBar, ListError, Panel, SavedViewBar, SelectField, SkeletonBody, StaleError, StatCard, StatusTag, SwitchField, TextAreaField } from '~/admin-ui/radar';