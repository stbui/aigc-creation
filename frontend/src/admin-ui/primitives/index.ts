/**
 * 后台共享组件与数据逻辑实现层。
 *
 * 页面**不直连**本 barrel；`radar/index.ts` 先透传这里的全部导出，再用 Radar
 * 覆盖品牌可见、高频的组件。页面统一从 `admin-ui/radar` 取件。
 *
 * 目录约定：
 *   - `components/ui/` —— shadcn 原始组件（CLI 生成 + `scripts/post-shadcn.mjs` 处理）；
 *   - `primitives/`    —— 共享实现层，由 `radar/index.ts` 透传；
 *   - `radar/`         —— 页面公开入口与中性风格覆盖件；
 *   - `hooks/`         —— 列表 / 单资源 / URL 同步等数据逻辑；
 *   - `providers/`     —— toast、二次确认、tooltip 上下文；
 *   - `shell/`         —— 外壳与全局搜索。
 */

export {
  PageHeader,
  Panel,
  StatCard,
  StatCards,
  type StatCardItem,
  SaveBar,
  DetailSection,
  BatchBar,
  EmptyState,
  ListError,
  StaleError,
} from './layout';

export { AdminPage, AdminTabs } from './page';

export {
  WorkQueue,
  WorkQueueSection,
} from './work-queue';

export { ContextBanner } from './context-banner';
export { SavedViewBar } from './saved-view-bar';

export { ExportCsvButton, RefreshButton, type ExportCsvButtonProps, type RefreshButtonProps } from './actions';

export {
  FormField,
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
  SwitchField,
  ClearableField,
  ActionButton,
  ToneBadge,
  SegmentedTabs,
  SegmentedGroup,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  type SelectFieldOption,
  type Tone,
} from './form';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from '../components/ui/card';
export { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
export { Badge } from '../components/ui/badge';
export { Button } from '../components/ui/button';
export { Separator } from '../components/ui/separator';
export { Spinner } from '../components/ui/spinner';
export { Toggle } from '../components/ui/toggle';

export {
  FilterBar,
  FilterActions,
  AppliedFilters,
  StatusTag,
  Notice,
  Meter,
  MiniStat,
  Descriptions,
  Pagination,
  type AppliedFilter,
  type TagTone,
} from './display';

export {
  PageSkeleton,
  SkeletonPanel,
  SkeletonBody,
  SkeletonStats,
  SkeletonCards,
  SkeletonDutyStrip,
  SkeletonTabs,
  Skeleton,
} from './skeleton';

export { DateField, DateRangeField } from './date-fields';

export {
  CheckboxField,
  FilePicker,
  HelpTip,
  IconButton,
  ColorField,
  RangeField,
  SuggestField,
} from './fields';

export { AdminDataTable, type AdminColumn, type AdminDataTableProps } from './table';

export {
  ModalDialog,
  Drawer,
  ConfirmDialog,
  RowMenu,
  DRAWER_WIDTH,
  MODAL_WIDTH,
  type DrawerSize,
  type ModalSize,
  type RowMenuItem,
} from './overlay';
export { FormDrawer } from './formDrawer';
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
export { AdminDrawer, AdminModal } from './DetailDialog';
export { DutyChannelTower, earliestFailure } from './duty-tower';
export { DutyStrip } from './duty-strip';
export { TrendBarChart } from './chart';

export { useAdminList, useAdminResource, useAdminUrlFilterSync, useAdminDetailParam } from '../hooks/useAdminList';
export { useSelectionPrune } from '../hooks/useSelection';
export { useAdminExport } from '../hooks/useAdminExport';

export {
  formatDateTime,
  formatDate,
  formatTime,
  formatMonthDayTime,
  formatHm,
  formatDuration,
  formatRelative,
  formatYuan,
  formatYuanPlain,
  formatYuanGrouped,
  formatDecimal,
  formatBytes,
  formatNumber,
  tickHeight,
} from '../lib/format';
