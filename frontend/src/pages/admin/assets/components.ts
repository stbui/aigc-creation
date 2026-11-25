/**
 * assets 的外部控件唯一入口（按 `docs/design/standards/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的 `~/admin-ui/radar` 控件与配套类型；目录内文件
 * 一律从 `./components` 取，不直连 `~/admin-ui`。本模块自有业务组件仍由各文件
 * 直接 `./Xxx` 引用，不在此聚合，避免循环引用。
 *
 * 工具函数走 `./utils`，hook 走 `./hooks`，类型走 `./types`。
 */

export { ActionButton, type AdminColumn, AdminDataTable, AdminPage, type AppliedFilter, AppliedFilters, Button, CheckboxField, ClearableField, ConfirmDialog, EmptyState, ExportCsvButton, FilterActions, FilterBar, FormDrawer, FormField, ListError, Notice, Pagination, Panel, SegmentedGroup, SegmentedTabs, SelectField, SkeletonBody, StaleError, StatusTag, TextField } from '~/admin-ui/radar';
