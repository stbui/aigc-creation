/**
 * 素材库页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `library/` 下的文件不从 `src/components` / `src/ui` 直接取东西,
 * 一律经由本文件 —— 页面用到的共享控件集中可见, 替换或加埋点只改一处。
 *
 * 第三方 UI 库 (lucide-react) 与 react-router 不经本文件。
 */

/** 结果媒体 (图片 / 视频) 与格式判定 */
export { ResultMedia, modalityOfFormat } from '../../components/ResultMedia';
/** 大图查看器与它的数据类型 */
export { ImageLightbox, type LightboxItem } from '../../components/ImageLightbox';
/** 失败态 / 骨架屏 */
export { StateError, StateSkeleton } from '../../components/StateViews';
/** 手机扫码上传弹窗 */
export { MobileUploadModal } from '../../components/MobileUploadModal';

/** shadcn 组合件与类名合并 */
export {
  Button,
  Checkbox,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
  Input,
  Modal,
  Popconfirm,
  Select,
  StatusBadge,
  Surface,
  SurfaceContent,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  ToggleGroup,
  cn,
} from '../../ui';
