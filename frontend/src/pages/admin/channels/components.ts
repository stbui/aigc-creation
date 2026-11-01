/**
 * 渠道工作台的复用控件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `channels/` 下的文件不从 `src/admin-ui` / `src/components` / `src/vendor` 直接取东西,
 * 一律经由本文件 —— 页面用到的后台控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享控件引用时在这里补一行 re-export。
 *
 * 本目录自己的板块组件 (`ChannelListPanel` / `ChannelDetailPanel` / `ChannelModelManager` /
 * `ChannelModelTable` / 各弹窗) 不在此转出: 它们依赖本目录的 hooks 与接口,
 * 反向 re-export 会形成循环引用。
 */

/** 主 / 次按钮 (BoardUI) */
export { Button } from '../../../vendor/boardui/components/base/buttons/button';
/** 图标按钮 (排序列表的行操作) */
export { IconButton } from '../../../vendor/boardui/components/base/buttons/icon-button';

/** 表单控件 */
export {
  CheckBox,
  FilePick,
  HoverTip,
  NumberInput,
  SegmentedBox,
  SelectBox,
  SwitchBox,
  TextArea,
  TextInput,
  type SegmentedOption,
  type SelectOption,
} from '../../../admin-ui/controls';

/** 展示原语 (空态 / 键值表 / 提示条 / 表单行) */
export {
  Descriptions,
  EmptyState,
  FormField,
  Notice,
} from '../../../admin-ui/primitives';
/** 数据表格与列定义 */
export { AdminDataTable, type AdminColumn } from '../../../admin-ui/primitives/DataTable';
/** 弹窗 (上游导入 / 模型编辑 / 调价) */
export { ModalDialog } from '../../../admin-ui/primitives/Dialog';
/** 抽屉 (渠道新建 / 编辑) */
export { Drawer } from '../../../admin-ui/primitives/Drawer';

/** 反馈入口 */
export { useToast } from '../../../admin-ui/providers/ToastProvider';
export { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';

/** 页头 / 面板 / 状态标签 / 筛选条 */
export {
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
} from '../../../components/admin/PageHeader';
/** 后台通用数据态与二次确认 */
export {
  AdminStaleError,
  ConfirmAction,
  useAdminDetailParam,
  useAdminResource,
} from '../../../components/admin/AdminWidgets';
