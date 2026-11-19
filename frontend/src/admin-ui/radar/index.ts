/**
 * 中性风格（freebie-radar）后台组件层。
 *
 * 策略：先 `export *` 透传 `~/admin-ui/primitives` 的全部导出（数据 Hook、format
 * 工具、ui 原子件、复杂专用件），这些在页面内容区（`.radar-scope`）内会自动中性化；
 * 再用下方显式导出覆盖「品牌可见、高频」的件，改用 `radar-*` 令牌与零阴影 / 1px 细线
 * 语言。显式导出优先于 star 再导出，不冲突。
 *
 * 页面接入：业务页面统一从 `~/admin-ui/radar` 取件，并用 `RadarPage` 包裹
 * 内容区；数据 Hook 与格式化函数通过本入口透传，页面不直连 primitives。
 */
export * from '../primitives';
export { cn } from '../lib/cn';

/* ── radar 覆盖件（优先于上面的 star 再导出）── */
export { Button } from './Button';
export { RadarBadge, KindBadge, ObtainBadge, ScoreBadge, CodeChip } from './Badge';
export {
  RadarPage,
  PageHeader,
  Panel,
  StatCard,
  StatCards,
  type StatCardItem,
  Segmented,
  EmptyState,
  ListError,
  StaleError,
  SkeletonBody,
  WorkQueue,
  WorkQueueSection,
} from './blocks';
export { Drawer, DRAWER_WIDTH, type DrawerSize } from './Drawer';
export { SheetModal } from './SheetModal';
export { Toast } from './Toast';
export {
  StatusTag,
  Notice,
  MiniStat,
  Descriptions,
  Meter,
  Pagination,
  FilterBar,
  FilterActions,
  type AppliedFilter,
  type TagTone,
} from './feedback';
export {
  FormField,
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
  SwitchField,
  CheckboxField,
  RangeField,
  IconButton,
  HelpTip,
  ClearableField,
  ToneBadge,
  SegmentedTabs,
  SegmentedGroup,
  ActionButton,
  type SelectFieldOption,
  type Tone,
} from './forms';
export {
  ModalDialog,
  ConfirmDialog,
  RowMenu,
  MODAL_WIDTH,
  type ModalSize,
  type RowMenuItem,
} from './overlays';
export { AdminPage, AdminTabs, TabsContent } from './page';
export { AdminDrawer, AdminModal } from './DetailDialog';
export { SavedViewBar } from './SavedViewBar';
export { ConfirmAlert } from './ConfirmAlert';
export { SaveBar, DetailSection, BatchBar } from './layout';
export { FormDrawer } from './formDrawer';
