/**
 * 爆款复刻工作台页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `viral-clone/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件 ——
 * 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (antd / lucide-react) 不经本文件 —— 它们不是本项目的共享控件,
 * 与 `channels/` / `product-detail/` / `product-kit/` 的做法一致。
 * `useAssetLibrary` 虽然定义在组件文件里, 但属于 hook, 统一从 `./hooks` 取。
 */

/** 上传区 (拖拽 / 粘贴 / 素材库 / 手机上传入口) */
export { ToolImageDropzone } from '../../components/ToolImageDropzone';
/** 底部提交栏 (生成按钮 + 价签 + 高级设置插槽) */
export { ToolSubmitBar } from '../../components/ToolSubmitBar';
/** 高级设置浮层 (比例 + 画质) */
export { ToolSettingsPopover } from '../../components/ToolSettingsPopover';
/** 模型选择 */
export { ModelPicker } from '../../components/ModelPicker';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 空态与工作流步骤说明 */
export { ToolWorkflowSteps } from '../../components/ToolEmptyState';
/** 右侧结果网格 */
export { ResultGalleryPane } from '../../components/ResultGalleryPane';
/** 图片右键菜单的条目类型 */
export type { ImageMenuItem } from '../../components/ImageContextMenu';
