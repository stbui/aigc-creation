import * as boardui from '../../admin-ui/widgets/AdminChrome';
import { Panel as BoardUIPanel } from '../../admin-ui/primitives';

/**
 * 后台页面骨架控件。
 *
 * 35 个页面都从这里取页头、筛选条、面板、统计卡、状态标签。渲染层只有一份：
 * `admin-ui/widgets/AdminChrome`，实现在 `admin-ui/shadcn/kit`（shadcn）。
 *
 * 2026-11-01：整站换 shadcn。这一层保持**导出名与签名不变**，只把实现从
 * BoardUI 换成 `shadcn/kit` —— 页面 import 与业务代码一行不改。此后不再存在
 * 「页面是新的、外壳是旧的」中间态，也不需要任何切换开关。
 */
export const PageHeader = boardui.PageHeader;
export const FilterBar = boardui.FilterBar;
export const FilterActions = boardui.FilterActions;
export const AppliedFilters = boardui.AppliedFilters;
export const StatCard = boardui.StatCard;
export const CollapsiblePanel = boardui.CollapsiblePanel;
export const AdminEmpty = boardui.AdminEmpty;
export const StatusTag = boardui.StatusTag;

/** `Panel` 由 primitives 提供（支持 `isNarrow` 限宽），与页面用法一致 */
export const Panel = BoardUIPanel;

export type { AppliedFilter } from '../../admin-ui/widgets/AdminChrome';
export type { TagTone } from './statusMeta';
