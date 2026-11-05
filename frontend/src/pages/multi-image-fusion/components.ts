/**
 * 多图融合页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `multi-image-fusion/` 下的文件不从 `src/components` 直接取东西,
 * 一律经由本文件 —— 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (antd / lucide-react) 不经本文件 —— 它们不是本项目的共享控件。
 * 本页不走 `ToolShell` 外壳: 两步流 (场景网关 / 工作区) 有自己的版式。
 */

/** 图片与结果的口径类型 (与 ToolShell 共用) */
export type { ToolAsset, ToolResult } from '../../components/ToolShell';
/** 结果占位: 生成中的骨架 */
export { ToolGeneratingState } from '../../components/ToolEmptyState';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
