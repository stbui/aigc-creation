/**
 * 爆款复刻工作台页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `viral-clone/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件 ——
 * 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (lucide-react) 不经本文件 —— 它们不是本项目的共享控件,
 * 与 `channels/` / `product-detail/` / `product-kit/` 的做法一致。
 * `useAssetLibrary` 属于 hook, 统一从 `./hooks` 取。
 */

/** 上传区 (拖拽 / 粘贴 / 素材库 / 手机上传入口) */
export { ToolImageDropzone } from '../../components/ToolImageDropzone';
/** 商品基础字段（名称 / 品牌 / 平台 / 语言） */
export { ProductFieldsGrid, SelectField } from '../../components/ProductFormSection';
/** 左栏底部提交区（高级设置 + 模型选择 + 主按钮） */
export { ToolGenerationSubmitBar } from '../../components/ToolGenerationSubmitBar';
/** 业务类型跨页 tab（商品主图 / 商品详情 / 爆款复刻） */
export { ToolTypeTabs } from '../../components/ToolTypeTabs';
/** 文本放大编辑弹窗 */
export { ExpandTextModal } from '../../components/ExpandTextModal';
/** 模型选择 */
export { ModelPicker } from '../../components/ModelPicker';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 空态与工作流步骤说明 */
export { ToolWorkflowSteps } from '../../components/ToolEmptyState';
/** 右侧「功能示例 / 创作结果」页签外壳 (与商品详情 / 商品主图共用) */
export { OutputTabsPane, type OutputTab } from '../../components/OutputTabsPane';
/** 批次行头口径 (与商品详情 / 商品主图共用): 时间 / 参数摘要 / 状态 */
export {
  formatBatchDate,
  resultMetaOf,
  resultStatusOf,
  type ResultMeta,
  type ResultStatusTone,
} from '../../components/batchResult';
/** 右侧结果网格 */
export { ResultGalleryPane } from '../../components/ResultGalleryPane';
/** 功能示例展示骨架 (与商品详情 / 商品主图共用) */
export {
  ToolExampleCard,
  ToolExampleFactList,
  ToolExamplePanel,
  type ToolExampleFact,
  type ToolExampleStep,
} from '../../components/ToolExamplePanel';
/** 图片大图查看器与查看器条目类型 */
export { ImageLightbox } from '../../components/ImageLightbox';
export type { LightboxItem } from '../../components/ImageLightbox';
/** 图片右键菜单的条目类型 */
export type { ImageMenuItem } from '../../components/ImageContextMenu';

/** shadcn 组合件：页面布局、表单、结果状态与轻提示统一从 C 端 UI 入口取用。 */
export {
  Button,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  InlineAlert,
  InlineAlertDescription,
  InlineAlertTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  NavigationTabs,
  NavigationTabsList,
  NavigationTabsTrigger,
  Select,
  Separator,
  Skeleton,
  StatusBadge,
  Surface,
  SurfaceAction,
  SurfaceContent,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  Textarea,
  ToggleGroup,
  cn,
} from '../../ui';
export type { SelectOption } from '../../ui';
