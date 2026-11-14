/**
 * 写真模板页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定：`template/` 下的文件不从 `src/components` 直接取东西，
 * 一律经由本文件 —— 页面用到的共享控件集中可见，替换或加埋点只改一处。
 * 第三方 UI 库 (lucide-react) 不经本文件 —— 它们不是本项目的共享控件。
 */

/** 上传区 (拖拽 / 粘贴 / 素材库 / 手机上传入口) */
export { ToolImageDropzone } from '../../components/ToolImageDropzone';
/** 底部提交栏 (高级设置 + 模型选择 + 生成按钮 + 价签)，商品主图 / 商品详情同款 */
export { ToolGenerationSubmitBar } from '../../components/ToolGenerationSubmitBar';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 大图查看器与它的数据类型 */
export { ImageLightbox, type LightboxItem } from '../../components/ImageLightbox';
/** 结果网格 (全部记录抽屉) */
export { ResultGalleryPane } from '../../components/ResultGalleryPane';
/** 右栏「创作灵感 / 创作结果」页签外壳（与商品主图 / 商品详情共用） */
export { OutputTabsPane, type OutputTab } from '../../components/OutputTabsPane';
/** 模型选择器（写真模板页隐藏实时报价行，见 TemplateInputPane） */
export { ModelPicker } from '../../components/ModelPicker';
