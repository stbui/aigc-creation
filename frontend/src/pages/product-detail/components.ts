/**
 * 商品详情图页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `product-detail/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件 ——
 * 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 本页自己的板块组件 (`DetailSectionPicker` / `DetailExamplePanel`) 不在此转出:
 * 它们依赖本页的 hooks 与接口, 反向 re-export 会形成循环引用。
 *
 * 第三方 UI 库 (lucide-react) 不经本文件 —— 它们不是本项目的共享控件,
 * 与 `channels/` 的做法一致。
 */

/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 批次结果卡片 (本页 / 商品主图共用) 与它的行类型 */
export {
  BatchResultCardList,
  type BatchResultCardListProps,
} from '../../components/BatchResultCardList';
export type { BatchCardRow, BatchRowBase, ResultMeta } from '../../components/batchResult';
/** 文本放大编辑弹窗 */
export { ExpandTextModal } from '../../components/ExpandTextModal';
/** 大图查看器与它的数据类型 */
export { ImageLightbox, type LightboxItem } from '../../components/ImageLightbox';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 模型选择 */
export { ModelPicker } from '../../components/ModelPicker';
/** 右侧「功能示例 / 创作结果」页签外壳（与商品主图共用） */
export { OutputTabsPane } from '../../components/OutputTabsPane';
/** 商品信息配置卡（商品图 + 基础字段 + 商品描述） */
export {
  ProductDescriptionField,
  type ProductDescriptionFieldProps,
  ProductFieldsGrid,
  type ProductFieldsGridProps,
  ProductFormSection,
  type ProductFormSectionProps,
  ProductImageField,
  type ProductImageFieldProps,
  SelectField,
} from '../../components/ProductFormSection';
/** 批次结果列表 / 右栏（与商品主图共用） */
export {
  ToolBatchOutputPane,
  type ToolBatchOutputPaneProps,
  ToolBatchResultList,
  type ToolBatchResultListProps,
} from '../../components/ToolBatchOutputPane';
/** 空态与工作流步骤说明 */
export { ToolEmptyState, ToolWorkflowSteps } from '../../components/ToolEmptyState';
/** 功能示例展示骨架（与商品主图 / 爆款复刻共用） */
export {
  ToolExampleCard,
  type ToolExampleFact,
  ToolExampleFactList,
  ToolExamplePanel,
  ToolExampleSource,
  type ToolExampleStep,
} from '../../components/ToolExamplePanel';
/** 左栏底部提交区（高级设置 + 模型选择 + 主按钮） */
export { ToolGenerationSubmitBar } from '../../components/ToolGenerationSubmitBar';
/** 上传区 (拖拽 / 粘贴 / 素材库 / 手机上传入口) */
export { ToolImageDropzone } from '../../components/ToolImageDropzone';
/** 业务类型跨页 tab（商品主图 / 商品详情 / 爆款复刻） */
export { ToolTypeTabs } from '../../components/ToolTypeTabs';
export type { PublicModelGroup } from '../../lib/models';
/** 选项结构类型 (下拉的 value / label 形态) */
export type { ParamOption } from '../../types/api';
