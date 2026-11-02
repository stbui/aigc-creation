/**
 * 渠道工作台的复用控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `channels/` 下的文件不从 `src/admin-ui` / `src/components` 直接取东西,
 * 一律经由本文件 —— 页面用到的后台控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享控件引用时在这里补一行 re-export。
 *
 * 本目录自己的板块组件 (`ChannelListPanel` / `ChannelDetailPanel` / `ChannelModelManager` /
 * `ChannelModelTable` / 各弹窗) 不在此转出: 它们依赖本目录的 hooks 与接口,
 * 反向 re-export 会形成循环引用。
 *
 * 来源固定为 `admin-ui/primitives`（后台组件唯一取用层）—— 页面不直连
 * `components/ui` 的原子件，也不使用已删除的旧套件。
 */

export {
  /* 按钮 */
  ActionButton,
  IconButton,
  /* 表单控件 */
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
  SwitchField,
  ClearableField,
  CheckboxField,
  FilePicker,
  HelpTip,
  SegmentedTabs,
  SegmentedGroup,
  type SelectFieldOption,
  /* 展示原语 */
  Descriptions,
  EmptyState,
  FormField,
  Notice,
  Skeleton,
  /* 数据表格与列定义 */
  AdminDataTable,
  type AdminColumn,
  /* 弹窗 / 抽屉 / 二次确认 */
  ModalDialog,
  Drawer,
  ConfirmAction,
  /* 页头 / 面板 / 状态标签 / 筛选条 */
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  SaveBar,
  StatusTag,
  /* 数据态 */
  ListError,
  StaleError,
} from '../../../admin-ui/primitives';
