/**
 * 用户管理的复用控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 来源固定为 `admin-ui/primitives`；本目录自己的业务组件不在此转出
 * （反向 re-export 会形成循环引用）。
 */

export {
  ActionButton,
  AdminDataTable,
  AdminDrawer,
  AppliedFilters,
  BatchBar,
  BatchResultModal,
  ClearableField,
  ConfirmAction,
  DetailSection,
  EmptyState,
  FilterActions,
  FilterBar,
  FormField,
  ListError,
  PageHeader,
  Panel,
  RowMenu,
  SelectField,
  SkeletonBody,
  StatusTag,
  StaleError,
  TextField,
  type AdminColumn,
  type AppliedFilter,
} from '../../../admin-ui/primitives';
