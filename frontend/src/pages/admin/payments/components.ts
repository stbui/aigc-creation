/**
 * 支付充值的复用控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定：`payments/` 下的文件不从 `src/admin-ui` / `src/components` 直接取东西，
 * 一律经由本文件 —— 页面用到的后台控件集中可见，替换或加埋点只改一处。
 * 目录内新增共享控件引用时在这里补一行 re-export。
 *
 * 来源固定为 `admin-ui/primitives`（后台组件唯一取用层）—— 页面不直连
 * `components/ui` 的原子件。
 *
 * 本目录自己的标签组件（`PaymentsProvidersTab` 等）不在此转出：它们依赖本目录的
 * hooks 与接口，反向 re-export 会形成循环引用。
 */

export {
  /* 按钮 */
  ActionButton,
  /* 表单控件 */
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
  SwitchField,
  FormField,
  /* 展示原语 */
  Descriptions,
  EmptyState,
  Notice,
  Panel,
  PageSkeleton,
  Skeleton,
  StatCard,
  StatusTag,
  /* 数据表格与列定义 */
  AdminDataTable,
  type AdminColumn,
  /* 弹窗 / 抽屉 / 二次确认 */
  Drawer,
  ConfirmAction,
  /* 页头 / 筛选条 */
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  SegmentedTabs,
  type AppliedFilter,
  /* 数据态 */
  ListError,
  StaleError,
} from '../../../admin-ui/primitives';
