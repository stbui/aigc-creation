/**
 * 支付配置模块的外部控件唯一入口（按 `docs/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的 `~/admin-ui/radar` 控件与配套类型，目录内文件一律从
 * `./components` 取控件，不直连 `~/admin-ui`；本模块自有业务组件仍由各文件
 * 直接 `./Xxx` 引用，不在此聚合（避免循环引用）。
 *
 * 工具函数（`cn` / `moneyText` 等）走 `./utils`；hook 走 `./hooks`；接口走 `./api`；
 * 类型走 `./types`；常量走 `./constants`。新增引用时在这里补一行 re-export。
 */

export {
  ActionButton,
  AdminDataTable,
  AdminPage,
  AdminTabs,
  AppliedFilters,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  ConfirmDialog,
  DateField,
  Drawer,
  EmptyState,
  ExportCsvButton,
  FilePicker,
  FilterActions,
  FilterBar,
  FormField,
  IconButton,
  ListError,
  Meter,
  ModalDialog,
  Notice,
  NumberField,
  Panel,
  RefreshButton,
  SegmentedGroup,
  SelectField,
  SkeletonCards,
  StaleError,
  StatusTag,
  SwitchField,
  TabsContent,
  TextAreaField,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/radar';
