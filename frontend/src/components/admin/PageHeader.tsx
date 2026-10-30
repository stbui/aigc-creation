import * as boardui from '../../admin-ui/widgets/AdminChrome';
import { Panel as BoardUIPanel } from '../../admin-ui/primitives';

/**
 * 后台页面骨架控件。
 *
 * 29 个页面都从这里取页头、筛选条、面板、统计卡、状态标签。渲染层只有一份：
 * `admin-ui/widgets/AdminChrome`（BoardUI）。
 *
 * 2026-10-30：此前这里按 `VITE_ADMIN_UI` 在 BoardUI 与 antd 两份实现之间分流。
 * 29 页全部迁完后那份 antd 实现已无调用方（纯 C 决策不允许交付「页面是新的、
 * 外壳是旧的」中间态），随 P4 一并删除，切换开关 `VITE_ADMIN_UI` 同时下线。
 * 页面 import 不变，签名不变。
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
