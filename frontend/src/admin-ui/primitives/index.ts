/**
 * 后台页面唯一取用层。
 *
 * 页面**不直连** `components/ui`（那是 shadcn 的原子件）。这里把后台真正需要
 * 的组合形态收成一份：页面骨架、筛选、表格、表单、浮层、状态展示。
 *
 * 目录约定：
 *   - `components/ui/` —— shadcn 原始组件（CLI 生成 + `scripts/post-shadcn.mjs` 处理）；
 *   - `primitives/`    —— 本目录，业务页面唯一 import 来源；
 *   - `hooks/`         —— 列表 / 单资源 / URL 同步等数据逻辑；
 *   - `providers/`     —— toast、二次确认、tooltip 上下文；
 *   - `shell/`         —— 外壳与全局搜索。
 */

export {
  PageHeader,
  Panel,
  StatCard,
  SaveBar,
  DetailSection,
  BatchBar,
  EmptyState,
  ListError,
  StaleError,
} from './layout';

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
  FilterBar,
  FilterActions,
  AppliedFilters,
  StatusTag,
  Notice,
  Meter,
  Descriptions,
  Pagination,
  EmptyHint,
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

export { ModalDialog, Drawer, ConfirmAction, RowMenu, type RowMenuItem } from './overlay';
export { AdminDrawer } from './Drawer';
export { BatchResultModal } from './batch-result';
export { DutyChannelTower, earliestFailure } from './duty-tower';
export { DutyStrip } from './duty-strip';
export { TrendBarChart } from './chart';

export {
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
  useAdminDetailParam,
} from '../hooks/useAdminList';

export {
  formatDateTime,
  formatDate,
  formatTime,
  formatDuration,
  formatRelative,
  formatYuan,
  formatBytes,
  formatNumber,
  tickHeight,
} from '../lib/format';
