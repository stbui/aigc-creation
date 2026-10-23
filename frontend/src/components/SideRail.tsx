import { useRef, useState } from 'react';
import { RailPreview } from './RailPreview';
import { Link, useLocation } from 'react-router-dom';
import {
  Sparkles,
  LayoutGrid,
  Images,
  BarChart3,
  Library,
  LayoutPanelLeft,
  Scissors,
  Expand,
  RotateCcw,
  Palette,
  Eraser,
  Languages,
  Flame,
  Wand2,
  Brush,
  Layers,
  Boxes,
  Video,
  PanelLeftClose,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { toolPath } from '../lib/capabilities';

/**
 * 侧边菜单 —— 1:1 复刻参考站 workspace-side-menu-v2 (2026-10-18 重构)。
 *
 * 参考站产物 CSS 实测字面值:
 *   容器 176px / padding 16 12 24 24 / bg #fff / border-right 1px #f2f3f5
 *   head 32px (仅右侧 collapse 按钮) / collapse 24x24 radius8 hover #f7f6ff border #e5e7ef
 *   list grid gap4 padding-top4 / 按钮 45px 高 padding 8 4 / gap12 / 13px / radius8 / #333
 *   hover #5546d8 on #f7f6ff / active(#5546d8 on #f1efff) / [aria-current=page] 同 active
 *   折叠态(side-menu-collapsed): list 3 列 gap8 / 按钮居中 / 文字 10px lh14
 * <1400px 参考站自动切 100px 垂直轨 (aside pad 8 8 20 / 条目 77×60 图标置顶 / 标签 10px,
 *   active #f1efff+#5546d8) —— 该态由 global.css @media (max-width: 1399px) 以
 *   .app-sider-wrap 作用域实现 (容器宽度亦由 CSS 托管, 不再由 JSX inline 注入)。
 * 本地自有功能 (参考站无对应, 已登记): hover 产出预览卡 / 作品数徽标 / 免费·规划中圆点
 */

const ICONS: Record<string, LucideIcon> = {
  main_image: LayoutGrid,
  detail_image: LayoutPanelLeft,
  matting: Scissors,
  expand: Expand,
  rotate: RotateCcw,
  recolor: Palette,
  enhance: Sparkles,
  remove_watermark: Eraser,
  image_translate: Languages,
  hot_remake: Flame,
  creative_image: Wand2,
  local_redraw: Brush,
  multi_fusion: Layers,
  sku_image: Boxes,
  free_create: Video,
};

export function CapabilityIcon({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = ICONS[id] ?? Sparkles;
  return <Icon size={size} />;
}

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  /** 每项能力最近一次成功产出, 作为 hover 预览大图 (本地自有功能, 参考站无对应) */
  thumbs: Record<string, string | null>;
  activePath: string;
  statsTotal: number;
  onNavigate?: (to: string) => void;
}

export function SideRail({ groups, items, thumbs, activePath, statsTotal, onNavigate }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      className={`workspace-side-menu-v2${collapsed ? ' side-menu-collapsed' : ''}`}
      aria-label="侧边导航"
    >
      <div className="workspace-side-menu-head">
        <button
          type="button"
          className="workspace-side-collapse"
          aria-label={collapsed ? '展开菜单' : '收起菜单'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="workspace-side-menu-sections">
        <div className="workspace-side-menu-list">
          <SideMenuItem
            to="/workbench"
            label="工作台"
            icon={<LayoutGrid size={20} />}
            active={activePath === '/workbench'}
            onNavigate={onNavigate}
          />
          <SideMenuItem
            to="/works"
            label="我的作品"
            icon={<Images size={20} />}
            active={activePath.startsWith('/works')}
            badge={statsTotal > 0 ? statsTotal : undefined}
            onNavigate={onNavigate}
          />
        </div>

        {groups.map((g) => {
          const list = items.filter((c) => c.group === g.id);
          if (list.length === 0) return null;
          return (
            <div key={g.id} className="workspace-side-menu-section">
              <div className="workspace-side-menu-list">
                {list.map((c) => (
                  <SideMenuItem
                    key={c.id}
                    cap={c}
                    thumb={thumbs[c.id] ?? null}
                    active={activePath === toolPath(c.id)}
                    onNavigate={onNavigate}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="workspace-side-menu-list">
          <SideMenuItem
            to="/stats"
            label="数据中心"
            icon={<BarChart3 size={20} />}
            active={activePath.startsWith('/stats')}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SideMenuItem
            to="/library"
            label="素材库"
            icon={<Library size={20} />}
            active={activePath.startsWith('/library')}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        </div>
      </div>
    </nav>
  );
}

function SideMenuItem({
  to,
  label,
  icon,
  active,
  badge,
  onNavigate,
  cap,
  thumb,
  collapsed = false,
}: {
  to?: string;
  label?: string;
  icon?: React.ReactNode;
  active: boolean;
  badge?: number;
  onNavigate?: (to: string) => void;
  cap?: CapabilityDef;
  thumb?: string | null;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const planned = cap?.mode === 'planned';
  const path = to ?? (planned ? '#' : toolPath(cap!.id));
  const text = label ?? cap!.name;
  const glyph = icon ?? <CapabilityIcon id={cap!.id} size={20} />;

  const dot =
    cap && (cap.badge || cap.mode !== 'real') ? (
      <span className={`side-menu-dot${cap.badge ? ' side-menu-dot-cta' : ''}`} />
    ) : null;

  const body = (
    <>
      <span className="side-menu-icon">{glyph}</span>
      <span className="side-menu-label">{text}</span>
      {dot}
      {badge !== undefined && <span className="side-menu-badge">{badge}</span>}
    </>
  );

  return (
    <div
      ref={anchorRef}
      className="side-menu-btn-wrap"
      onMouseEnter={() => !collapsed && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => !collapsed && setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {planned ? (
        <span
          className={`workspace-side-menu-btn side-menu-disabled${active ? ' active' : ''}`}
          aria-disabled
        >
          {body}
        </span>
      ) : (
        <Link
          to={path}
          onClick={() => onNavigate?.(path)}
          className={`workspace-side-menu-btn${active ? ' active' : ''}`}
          aria-current={active ? 'page' : undefined}
        >
          {body}
        </Link>
      )}

      {/* hover 预览走 portal: 侧栏有 overflow 滚动, 内联渲染会被裁掉 (本地自有功能) */}
      {open && !collapsed && anchorRef.current && cap && (
        <RailPreview
          anchor={anchorRef.current}
          title={cap.name}
          imageUrl={thumb ?? null}
          fallbackText={cap.sidebarHint ?? cap.summary}
        />
      )}
    </div>
  );
}
