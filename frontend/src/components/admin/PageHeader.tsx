import { USE_BOARDUI_ADMIN } from '../../admin-ui/lib/flag';
import * as boardui from '../../admin-ui/widgets/AdminChrome';
import { Panel as BoardUIPanel } from '../../admin-ui/primitives';
import * as legacy from './PageHeader.legacy';

/**
 * 后台页面骨架控件（入口）。
 *
 * 29 个页面都从这里取页头、筛选条、面板、统计卡、状态标签。渲染层有两份：
 * `admin-ui/widgets/AdminChrome`（BoardUI）与 `PageHeader.legacy`（antd 回滚
 * 路径），由 `VITE_ADMIN_UI` 决定。页面不感知差异，也就不需要改 import。
 *
 * 导出显式标注成 legacy 版的类型：条件表达式推导出的联合类型在 JSX 里无法
 * 稳定地做属性检查，而 legacy 的签名就是契约，BoardUI 版与之逐字一致。
 */
const impl = USE_BOARDUI_ADMIN ? boardui : legacy;

export const PageHeader: typeof legacy.PageHeader = impl.PageHeader;
export const FilterBar: typeof legacy.FilterBar = impl.FilterBar;
export const FilterActions: typeof legacy.FilterActions = impl.FilterActions;
export const AppliedFilters: typeof legacy.AppliedFilters = impl.AppliedFilters;
export const StatCard: typeof legacy.StatCard = impl.StatCard;
export const CollapsiblePanel: typeof legacy.CollapsiblePanel = impl.CollapsiblePanel;
export const AdminEmpty: typeof legacy.AdminEmpty = impl.AdminEmpty;
export const StatusTag: typeof legacy.StatusTag = impl.StatusTag;

/** `isNarrow` 在 BoardUI 版由 primitives 的 Panel 支持，两版签名一致 */
export const Panel: typeof legacy.Panel = USE_BOARDUI_ADMIN ? BoardUIPanel : legacy.Panel;

export type { AppliedFilter } from '../../admin-ui/widgets/AdminChrome';
export type { TagTone } from './statusMeta';
