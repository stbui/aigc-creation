/**
 * 产品精修页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `product-retouch/` 下的文件不从 `src/components` 直接取东西,
 * 一律经由本文件 —— 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (antd / lucide-react) 不经本文件 —— 它们不是本项目的共享控件。
 */

/** 工具页外壳 (左表单 / 右结果 / 尾部历史) */
export { ToolShell } from '../../components/ToolShell';
/** 单选 pill 与表单卡片 */
export { PillOptions, ToolCard } from '../../components/ToolWidgets';
/** 历史产出面板 */
export { ToolHistoryPane } from '../../components/ToolHistoryPane';
/** 商品图上传预览与原图展示 (与换色 / 详情图共用) */
export { ProductSourceResult, ProductSourceUploadPreview } from '../../components/ProductSourcePreview';
