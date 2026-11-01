/**
 * BoardUI 免费层没有的基础件（shadcn 实现）。
 *
 * 后台 29 页原先依赖 antd 的 Card / Empty / Skeleton / Result / Descriptions /
 * Steps / Form.Item，换成 shadcn 后这些形态统一收在 `admin-ui/shadcn/kit`。
 * 这个文件保留原来的导出名与签名，页面 import 不用改。
 *
 * 2026-11-01：实现整体切到 shadcn。此前这里是 BoardUI + 自绘件混排，
 * 与页头 / 表格的观感不是一套（圆角 12 vs 8、描边色两套）。
 */
export {
  Panel,
  SaveBar,
  EmptyState,
  Skeleton,
  Result,
  Descriptions,
  Steps,
  Notice,
} from '../shadcn/kit/display';
export { FormField } from '../shadcn/kit/controls';
