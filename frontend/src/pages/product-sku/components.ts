/**
 * 商品 SKU 图工作台页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `product-sku/` 下的文件不从 `src/components` 直接取东西, 一律经由本文件 ——
 * 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 * 目录内新增共享组件引用时在这里补一行 re-export。
 *
 * 第三方 UI 库 (antd / lucide-react) 不经本文件 —— 它们不是本项目的共享控件,
 * 与 `channels/` / `product-detail/` / `product-kit/` / `viral-clone/` 的做法一致。
 * `useAssetLibrary` 虽然定义在组件文件里, 但属于 hook, 统一从 `./hooks` 取。
 */

/** 工具页外壳 (左表单 / 右结果 / 尾部历史) */
export { ToolShell, type ToolAsset, type ToolSettings } from '../../components/ToolShell';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';
/** 大图查看器 */
export { ImageLightbox } from '../../components/ImageLightbox';
/** 批次结果面板 */
export { SkuResultPanel, type SkuResultItem } from '../../components/SkuResultPanel';
/** 历史提交面板 */
export { SkuHistoryPane } from '../../components/SkuHistoryPane';
/** 模板图区域框选弹窗 */
export { SkuRegionEditorModal, type SkuRegion } from '../../components/SkuRegionEditorModal';

/** shadcn 组合件：卡片、输入、按钮与加载态统一从 C 端 UI 入口取用。 */
export {
  Button,
  Input,
  InputGroup,
  InputGroupInput,
  InputGroupText,
  Spin,
  Surface,
  SurfaceAction,
  SurfaceContent,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '../../ui';
