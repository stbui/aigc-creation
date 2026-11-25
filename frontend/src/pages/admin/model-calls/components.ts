/**
 * 调用记录模块的外部控件唯一入口（按 `docs/design/standards/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的 `~/admin-ui/radar` 控件及其配套类型。目录内文件
 * 一律从 `./components` 取控件，不直连 `~/admin-ui`；本模块自有业务组件
 * （筛选条、列表区、详情抽屉）仍由各文件直接 `./Xxx` 引用，不在此聚合，避免
 * 循环引用。
 *
 * 工具函数（`formatDateTime` / `formatDuration`）不在此处，统一走 `./utils`；
 * hook 走 `./hooks`，类型走 `./types`。
 */

export {
  ActionButton,
  AdminDataTable,
  AdminDrawer,
  AdminPage,
  AppliedFilters,
  ClearableField,
  DateRangeField,
  Descriptions,
  DetailSection,
  FilterActions,
  FilterBar,
  Notice,
  Panel,
  RefreshButton,
  SelectField,
  StatusTag,
  StaleError,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/radar';
