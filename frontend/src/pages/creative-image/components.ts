/**
 * 创意生图 / 自由创作工作台页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `creative-image/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件 ——
 * 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (antd / lucide-react) 不经本文件 —— 它们不是本项目的共享控件,
 * 与 `channels/` / `product-detail/` / `product-kit/` / `viral-clone/` 的做法一致。
 * 本目录自有的业务组件也不在此转出（避免循环引用），由页面直接 `./Xxx` 引入。
 * `useAssetLibrary` 属于 hook, 统一从 `./hooks` 取。
 */

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
/** 右侧结果网格 */
export { ResultGalleryPane } from '../../components/ResultGalleryPane';
/** AI 润色弹窗 */
export { PromptPolishModal } from '../../components/PromptPolishModal';
/** 图片转提示词弹窗 */
export { ImageToPromptModal } from '../../components/ImageToPromptModal';
/** 参考图 / 结果的口径类型 (与 ToolShell 共用, 不再本页自定义) */
export type { ToolAsset, ToolResult } from '../../components/ToolShell';
