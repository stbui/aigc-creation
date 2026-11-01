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
 *
 * 2026-11-01: 整页换成 shadcn 观感。改动只有这一处 —— `admin-ui/shadcn/kit`
 * 导出件与本文件原先的 BoardUI 版**同名同签名**, 17 个文件、4400 行业务代码
 * 没有任何一行需要跟着改。这就是这个文件存在的理由。
 */

/** 控件套件（shadcn 版，签名与 BoardUI 版一致） */
export {
  /* 按钮 */
  Button,
  IconButton,
  /* 表单控件 */
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
  AdminEmpty,
  AdminListError,
  AdminStaleError,
} from '../../../admin-ui/shadcn/kit';
