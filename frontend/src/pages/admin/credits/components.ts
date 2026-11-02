/**
 * 积分账本的复用控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 来源固定为 `admin-ui/primitives`（后台组件唯一取用层）—— 页面不直连
 * `components/ui` 的原子件。本目录自己的抽屉组件（`CreditDetailDrawer` 等）
 * 不在此转出：它们依赖本目录的 hooks 与接口，反向 re-export 会形成循环引用。
 */

export {
  ActionButton,
  AdminDataTable,
  AppliedFilters,
  ClearableField,
  Descriptions,
  DetailSection,
  Drawer,
  EmptyState,
  FilePicker,
  FilterActions,
  FilterBar,
  FormField,
  ListError,
  Notice,
  PageHeader,
  Pagination,
  Panel,
  SelectField,
  SkeletonBody,
  StatCard,
  StatusTag,
  StaleError,
  TextAreaField,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from '../../../admin-ui/primitives';
