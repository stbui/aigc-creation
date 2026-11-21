/**
 * 任务监控模块的外部控件唯一入口（按 `docs/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的 `~/admin-ui/radar` 控件及其配套类型。目录内文件
 * 一律从 `./components` 取控件，不直连 `~/admin-ui`；本模块自有业务组件
 * （`TaskFilters` / `TaskListSection` / `TaskDetailModal` 等）仍由各文件直接
 * `./Xxx` 引用，不在此聚合，避免循环引用。
 *
 * 工具函数（`formatDateTime` / `formatDuration` / `toCredits` 等）不在此处，
 * 统一走 `./utils`；hook 走 `./hooks`，类型走 `./types`。
 */

/* 跨模块共享组件：测试包 Provider 时也从这里取，与页面用同一个模块实例 */
export { ToastProvider } from '~/admin-ui/providers/ToastProvider';

export {
  ActionButton,
  AdminDataTable,
  AdminModal,
  AdminPage,
  AdminTabs,
  AppliedFilters,
  BatchBar,
  Button,
  ClearableField,
  ConfirmDialog,
  ContextBanner,
  DateRangeField,
  Descriptions,
  DetailSection,
  ExportCsvButton,
  FilterActions,
  FilterBar,
  Notice,
  Panel,
  RefreshButton,
  RowMenu,
  SavedViewBar,
  SelectField,
  StaleError,
  StatCard,
  StatCards,
  StatusTag,
  TabsContent,
  TextField,
  Toggle,
  type AdminColumn,
  type AppliedFilter,
  type RowMenuItem,
  type SelectFieldOption,
  type TagTone,
} from '~/admin-ui/radar';
