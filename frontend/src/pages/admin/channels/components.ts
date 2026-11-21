/**
 * 渠道工作台的共享控件入口 —— 目录内文件的唯一外部控件来源
 * （按 `docs/frontend-module-conventions.md` §2）。
 *
 * 两件事收在这里：
 *   1. `~/admin-ui/radar` 的控件与配套类型 —— 目录内文件不直连 `~/admin-ui`；
 *   2. 跨模块共享组件（`ToastProvider`）—— 测试包 Provider 时也从这里取，
 *      与页面用的是同一个模块实例。
 *
 * 工具函数（`cn` / 金额 / 计数换算）走 `./utils`，hook 走 `./hooks`，
 * 类型走 `./types`。
 */

/* 跨模块共享组件 */
export { ToastProvider } from '~/admin-ui/providers/ToastProvider';

/* admin-ui/radar UI 控件 */
export {
  ActionButton,
  AdminDataTable,
  AdminPage,
  AppliedFilters,
  Button,
  CheckboxField,
  ClearableField,
  ConfirmDialog,
  Descriptions,
  EmptyState,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
  FilePicker,
  FilterActions,
  FilterBar,
  FormDrawer,
  FormField,
  HelpTip,
  IconButton,
  ModalDialog,
  Notice,
  NumberField,
  Panel,
  RowMenu,
  SegmentedGroup,
  SelectField,
  SkeletonBody,
  StaleError,
  StatCards,
  StatusTag,
  SwitchField,
  TextAreaField,
  TextField,
  Toggle,
  ToneBadge,
  type AdminColumn,
  type SelectFieldOption,
  type StatCardItem,
} from '~/admin-ui/radar';
