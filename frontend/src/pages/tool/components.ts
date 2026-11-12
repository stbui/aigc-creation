/**
 * 通用工具页的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 约定: `tool/` 下的文件不从 `src/components` / `src/ui` 直接取东西,
 * 一律经由本文件。第三方 UI 库 (lucide-react) 不经本文件。
 */

/** shadcn / 兼容层表单与展示件 */
export {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Slider,
  Switch,
  Tag,
  Typography,
  Upload,
  type FormInstance,
  type UploadFile,
} from '../../ui';
/** 能力图标 */
export { CapabilityIcon } from '../../layout';
/** 素材库选择弹窗 */
export { AssetLibraryModal } from '../../components/AssetLibraryModal';
/** 能力不存在 / 规划中 / 不可用的说明页 */
export { ExceptionPage } from '../../components/ExceptionPage';
/** 结果介质（图片 / 视频）与时长格式化 */
export { ResultMedia, formatDuration } from '../../components/ResultMedia';
/** 空态 / 骨架屏 */
export { StateEmpty, StateSkeleton } from '../../components/StateViews';
