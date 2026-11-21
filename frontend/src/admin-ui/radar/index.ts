/**
 * 中性风格（freebie-radar）后台组件层 —— 后台唯一的组件实现层与公开取件入口。
 *
 * 策略：本目录持有全部实现，barrel 显式列出导出，不做 `export *` 透传。
 * 历史上 `primitives/` 与 `radar/` 各有一份同名实现，透传后被上面的显式导出
 * 全部遮蔽（58 个导出），那些代码既不可达又被依赖图拖进产物；2026-11-20 起
 * 删掉重复实现，幸存件（表格 / 日期 / 文件与取色字段 / 图表 / 骨架 / CSV 导出 /
 * 值班视图 / 列表 Hook / 格式化）搬进本目录。
 *
 * 分组：
 *   - `components/ui/` —— shadcn 原子件，只供本层组合，页面不直连；
 *   - `radar/`         —— 页面唯一取件入口（本文件）；
 *   - `hooks/`         —— 列表 / 单资源 / URL 同步 / 未保存拦截等数据逻辑；
 *   - `providers/`     —— toast、二次确认、tooltip 上下文；
 *   - `shell/`         —— 外壳与全局搜索。
 *
 * 页面接入：业务页面统一从 `~/admin-ui/radar` 取件，并用 `RadarPage` 包裹内容区。
 * 唯一例外是外壳不可用时的 `AdminLoadError` / `AdminLoading` / `NoAdminAccess`。
 */
export { cn } from '../lib/cn';

/* ── 数据逻辑 ── */
export { useAdminList, useAdminResource, useAdminUrlFilterSync, useAdminDetailParam } from '../hooks/useAdminList';
export { useSelectionPrune } from '../hooks/useSelection';
export { useAdminExport } from '../hooks/useAdminExport';
export { useDiscardConfirm, useUnsavedGuard } from '../hooks/useUnsavedGuard';
export { useDetailData } from './detail-data';
export { useSavedViewBar } from './saved-view-state';

/* ── 格式化 ── */
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
} from '../lib/format';

/* ── shadcn 原子件转出 ── */
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
export { Button } from './Button';
export { Separator } from '../components/ui/separator';
export { Spinner } from '../components/ui/spinner';
export { Toggle } from '../components/ui/toggle';
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
export {
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
} from '../components/ui/field';
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '../components/ui/input-group';

/* ── 页面骨架与内容块 ── */
export { RadarPage, PageHeader, Panel, StatCard, StatCards, Segmented, type StatCardItem } from './blocks';
export { EmptyState, ListError, StaleError } from './states';
export { WorkQueue, WorkQueueSection } from './workQueue';
export { AdminPage, AdminTabs } from './page';
export { SaveBar, DetailSection, BatchBar } from './layout';

/* ── 展示件 ── */
export { RadarBadge } from './Badge';
export { StatusTag, Notice, MiniStat, Descriptions, Meter, Pagination, FilterBar, FilterActions, AppliedFilters, type AppliedFilter, type TagTone } from './feedback';
export { ContextBanner } from './context-banner';
export { TrendBarChart } from './chart';

/* ── 表单与控制 ── */
export { FormField, TextField, TextAreaField, NumberField, SelectField, ClearableField, type SelectFieldOption, type Tone } from './forms';
export { SwitchField, CheckboxField, RangeField, SegmentedTabs, SegmentedGroup } from './choice-fields';
export { ActionButton, IconButton, ToneBadge, HelpTip } from './action-bits';
export { FilePicker, ColorField, SuggestField } from './fields';
export { DateField, DateRangeField } from './date-fields';
export { ExportCsvButton, RefreshButton, type ExportCsvButtonProps, type RefreshButtonProps } from './actions';

/* ── 浮层 ── */
export { Drawer, DRAWER_WIDTH, type DrawerSize } from './Drawer';
export { ModalDialog, ConfirmDialog, RowMenu, MODAL_WIDTH, type ModalSize, type RowMenuItem } from './overlays';
export { ConfirmAlert } from './ConfirmAlert';
export { FormDrawer } from './formDrawer';
export { AdminDrawer, AdminModal } from './DetailDialog';
export { SavedViewBar } from './SavedViewBar';

/* ── 数据表格与占位 ── */
export { AdminDataTable, type AdminColumn, type AdminDataTableProps } from './table';
export { PageSkeleton, SkeletonPanel, SkeletonStats, SkeletonCards, SkeletonTabs, SkeletonBody, Skeleton } from './skeleton';