/**
 * 商品主图工作台页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `product-kit/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件 ——
 * 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (antd / lucide-react) 不经本文件 —— 它们不是本项目的共享控件,
 * 与 `channels/` / `product-detail/` 的做法一致。
 */

/** 上传区 (拖拽 / 粘贴 / 素材库 / 手机上传入口) */
export { ToolImageDropzone } from '../../components/ToolImageDropzone';
/** 底部提交栏 (生成按钮 + 价签 + 高级设置插槽) */
export { ToolSubmitBar } from '../../components/ToolSubmitBar';
/** 高级设置浮层 (比例 + 画质) */
export { ToolSettingsPopover } from '../../components/ToolSettingsPopover';
/** 模型选择 */
export { ModelPicker } from '../../components/ModelPicker';
/** 模型选择器上报的前台模型类型 */
export type { PublicLogicalModel } from '../../lib/models';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 空态与工作流步骤说明 */
export { ToolEmptyState, ToolWorkflowSteps } from '../../components/ToolEmptyState';
/** 大图查看器与它的数据类型 */
export { ImageLightbox, type LightboxItem } from '../../components/ImageLightbox';
/** 批次结果列表 (本页 / 详情图 / 带货图文共用) 与它的行类型 */
export { BatchResultList, type BatchRow } from '../../components/BatchResultList';
