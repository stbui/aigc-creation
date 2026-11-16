/**
 * 用户管理模块的外部控件唯一入口（按 `docs/frontend-module-conventions.md` §2）。
 *
 * 统一 re-export 本目录用到的外部 UI 控件（`~/admin-ui/radar`）、共享组件
 * （`~/components/admin`）及其配套类型。目录内文件一律从 `./components` 取控件，
 * 不直连 `~/admin-ui` / `~/components`；本模块自有业务组件仍由各文件直接 `./Xxx`
 * 引用，不在此聚合（避免循环引用）。
 *
 * 工具函数（`cn` / `formatYuan` 等）不在此处，统一走 `./utils`；hook 走 `./hooks`。
 */

/* 跨模块共享业务组件 */
export {
    BatchDeleteUsersDialog,
    BATCH_DELETE_LIMIT,
    BATCH_DELETE_CONFIRM,
} from '~/components/admin/BatchDeleteUsersDialog';
export { DeleteUsersConfirmDialog } from '~/components/admin/DeleteUsersConfirmDialog';

/* admin-ui/radar UI 控件 */
export {
  ActionButton,
  AdminDataTable,
  AdminDrawer,
  AdminPage,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AppliedFilters,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  ClearableField,
  DateRangeField,
  DetailSection,
  EmptyState,
  ExportCsvButton,
  FilterActions,
  FilterBar,
  FormField,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  ListError,
  MiniStat,
  ModalDialog,
  Pagination,
  SegmentedGroup,
  SelectField,
  Separator,
  SkeletonBody,
  SkeletonCards,
  StaleError,
  StatusTag,
  type AdminColumn,
  type AppliedFilter,
} from '~/admin-ui/radar';
