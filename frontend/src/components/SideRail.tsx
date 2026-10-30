import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Brush,
  ChevronUp,
  Eraser,
  Expand,
  Flame,
  Languages,
  LayoutGrid,
  LayoutPanelLeft,
  Layers,
  MessageSquarePlus,
  Palette,
  RotateCcw,
  Scissors,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { RailPreview } from './RailPreview';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { isCapabilityVisible, toolPath } from '../lib/capabilities';

/**
 * 侧边菜单 —— 对齐参考站 2026-10-28 的 `workspace-side-menu-v2`。
 *
 * 参考站当前结构：顶部「工作台 / 我的作品」，随后是 AI视频、电商生图、AI修图、
 * 数据中心四个可折叠分组，底部固定「产品建议 / 联系客服」。
 *
 * 响应式由 CSS 托管：
 *   - >1366px：176px 横排，条目 133×45、13px 标签、24px 静态菜单图标；
 *   - ≤1366px：100px 垂直轨，条目 77×60、10px 标签、分组标题 24px；
 *   - ≤900px：本地保留抽屉导航（参考站在 ≤768px 才隐藏侧栏，差异见文档）。
 *
 * 本地保留的真实差异：图生视频入口、数据看板入口、hover 预览优先使用用户最近产出；
 * 没有用户产出时回退到与参考站一致的演示图。
 */

const SIDEBAR_GROUP_ORDER = ['ai_video', 'ecommerce_gen', 'ai_retouch'];

const SIDEBAR_ITEM_ORDER: Record<string, string[]> = {
  ai_video: ['free_create', 'image_to_video'],
  ecommerce_gen: [
    'main_image',
    'detail_image',
    'hot_remake',
    'creative_image',
    'multi_fusion',
    'sku_image',
  ],
  ai_retouch: [
    'local_redraw',
    'matting',
    'remove_watermark',
    'enhance',
    'image_translate',
    'expand',
    'recolor',
    'rotate',
  ],
};

/** 参考站侧栏标签与能力注册表名称的两处差异；注册表仍保持完整能力名。 */
const SIDEBAR_LABELS: Record<string, string> = {
  detail_image: '商品详情',
};

/** 参考站 `/static/menu/*.svg` 的本地副本；运行时不请求参考站。 */
const SIDEBAR_ICONS: Record<string, string> = {
  workbench: '/menu/m_gzt.svg',
  works: '/menu/m_wdrw.svg',
  library: '/menu/m_xck.svg',
  free_create: '/menu/m_cyst.svg',
  image_to_video: '/menu/m_cyst.svg',
  main_image: '/menu/m_spzt.svg',
  detail_image: '/menu/m_spxq.svg',
  hot_remake: '/menu/m_bkfk.svg',
  creative_image: '/menu/m_cyst.svg',
  multi_fusion: '/menu/m_dtrh.svg',
  sku_image: '/menu/m_sku.svg',
  local_redraw: '/menu/m_jbch.svg',
  matting: '/menu/m_bjxc.svg',
  remove_watermark: '/menu/m_qcsy.svg',
  enhance: '/menu/m_cpjx.svg',
  image_translate: '/menu/m_tpfy.svg',
  expand: '/menu/m_znkt.svg',
  recolor: '/menu/m_sphs.svg',
  rotate: '/menu/m_jdxz.svg',
};

/** hover 预览图：参考站桌面端使用 `/static/work/*.webp`，本地已随工作台资产下载。 */
const SIDEBAR_PREVIEWS: Record<string, string> = {
  main_image: '/workbench/spzt.webp',
  detail_image: '/workbench/spxq.webp',
  hot_remake: '/workbench/bkfk.webp',
  creative_image: '/workbench/cyst.webp',
  local_redraw: '/workbench/jbch.webp',
  matting: '/workbench/bjxc.webp',
  remove_watermark: '/workbench/qcsy.webp',
  enhance: '/workbench/cpjx.webp',
  image_translate: '/workbench/tpfy.webp',
  expand: '/workbench/znkt.webp',
  recolor: '/workbench/sphs.webp',
  rotate: '/workbench/xzjd.webp',
};

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
  free_create: LayoutGrid,
};

export function CapabilityIcon({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = ICONS[id] ?? Sparkles;
  return <Icon size={size} />;
}

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  /** 每项能力最近一次成功产出；作为 hover 预览优先图。 */
  thumbs: Record<string, string | null>;
  activePath: string;
  onNavigate?: (to: string) => void;
}

export function SideRail({ groups, items, thumbs, activePath, onNavigate }: Props) {
  const uid = useId();
  const location = useLocation();
  const activeLocation = `${location.pathname}${location.search}`;
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});

  const toolIsActive = (id: string) => {
    const target = toolPath(id);
    return target.includes('?') ? activeLocation === target : activePath === target;
  };

  const sections = useMemo(() => {
    const groupRank = (id: string) => {
      const index = SIDEBAR_GROUP_ORDER.indexOf(id);
      return index === -1 ? SIDEBAR_GROUP_ORDER.length : index;
    };
    const itemRank = (groupId: string, id: string) => {
      const order = SIDEBAR_ITEM_ORDER[groupId] ?? [];
      const index = order.indexOf(id);
      return index === -1 ? order.length : index;
    };

    return groups
      .map((group) => ({
        ...group,
        items: items
          .filter((item) => item.group === group.id && isCapabilityVisible(item))
          .sort((a, b) => itemRank(group.id, a.id) - itemRank(group.id, b.id)),
      }))
      .filter((group) => group.items.length > 0)
      .sort((a, b) => groupRank(a.id) - groupRank(b.id));
  }, [groups, items]);

  const toggleSection = (id: string) => {
    setClosedSections((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  const renderCapability = (cap: CapabilityDef) => (
    <SideMenuItem
      key={cap.id}
      cap={cap}
      label={SIDEBAR_LABELS[cap.id] ?? cap.name}
      iconSrc={SIDEBAR_ICONS[cap.id]}
      previewImage={thumbs[cap.id] ?? SIDEBAR_PREVIEWS[cap.id] ?? null}
      active={toolIsActive(cap.id)}
      onNavigate={onNavigate}
    />
  );

  const dataCenterOpen = !closedSections.data_center;

  return (
    <nav className="workspace-side-menu-v2" aria-label="侧边导航">
      <div className="workspace-side-menu-sections">
        <section className="workspace-menu-section open workspace-menu-root-items">
          <div className="workspace-side-menu-list">
            <SideMenuItem
              to="/workbench"
              label="工作台"
              iconSrc={SIDEBAR_ICONS.workbench}
              active={activePath === '/workbench'}
              onNavigate={onNavigate}
            />
            <SideMenuItem
              to="/works"
              label="我的作品"
              iconSrc={SIDEBAR_ICONS.works}
              active={activePath.startsWith('/works')}
              onNavigate={onNavigate}
            />
          </div>
        </section>

        {sections.map((group) => {
          const open = !closedSections[group.id];
          const panelId = `${uid}-workspace-menu-section-${group.id}`;
          return (
            <section key={group.id} className={`workspace-menu-section${open ? ' open' : ''}`}>
              <button
                type="button"
                className="workspace-menu-section-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggleSection(group.id)}
              >
                <span className="workspace-menu-section-label">{group.name}</span>
                <ChevronUp size={14} aria-hidden="true" />
              </button>
              {open && (
                <div id={panelId} className="workspace-side-menu-list">
                  {group.items.map(renderCapability)}
                </div>
              )}
            </section>
          );
        })}

        <section className={`workspace-menu-section${dataCenterOpen ? ' open' : ''}`}>
          {/* 数据看板是本地真实 IA 增强；素材库保持参考站命名与顺序。 */}
          <button
            type="button"
            className="workspace-menu-section-toggle"
            aria-expanded={dataCenterOpen}
            aria-controls={`${uid}-workspace-menu-section-data-center`}
            onClick={() => toggleSection('data_center')}
          >
            <span className="workspace-menu-section-label">数据中心</span>
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          {dataCenterOpen && (
            <div
              id={`${uid}-workspace-menu-section-data-center`}
              className="workspace-side-menu-list"
            >
              <SideMenuItem
                to="/stats"
                label="数据看板"
                icon={<BarChart3 size={20} />}
                active={activePath.startsWith('/stats')}
                onNavigate={onNavigate}
              />
              <SideMenuItem
                to="/library"
                label="素材库"
                iconSrc={SIDEBAR_ICONS.library}
                active={
                  activePath.startsWith('/library') || activePath.startsWith('/asset-library')
                }
                onNavigate={onNavigate}
              />
            </div>
          )}
        </section>
      </div>

      <div className="workspace-customer-service">
        <Link
          to="/tickets?type=other&compose=1&subject=%E4%BA%A7%E5%93%81%E5%BB%BA%E8%AE%AE"
          className="product-suggestion-launcher product-suggestion-sidebar-launcher"
          onClick={() =>
            onNavigate?.('/tickets?type=other&compose=1&subject=%E4%BA%A7%E5%93%81%E5%BB%BA%E8%AE%AE')
          }
        >
          <span className="product-suggestion-sidebar-icon" aria-hidden="true">
            <MessageSquarePlus size={19} />
          </span>
          <span>产品建议</span>
        </Link>
        <Link
          to="/tickets?type=consultation&compose=1"
          className="workspace-customer-service-trigger"
          onClick={() => onNavigate?.('/tickets?type=consultation&compose=1')}
        >
          <span className="workspace-menu-icon" aria-hidden="true">
            <img src="/menu/m_kf.svg" alt="" />
          </span>
          <span>联系客服</span>
        </Link>
      </div>
    </nav>
  );
}

function SideMenuItem({
  to,
  label,
  icon,
  iconSrc,
  active,
  onNavigate,
  cap,
  previewImage,
}: {
  to?: string;
  label: string;
  icon?: ReactNode;
  iconSrc?: string;
  active: boolean;
  onNavigate?: (to: string) => void;
  cap?: CapabilityDef;
  previewImage?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const planned = cap?.mode === 'planned';
  const path = to ?? (planned ? '#' : toolPath(cap!.id));
  const glyph = iconSrc ? <img src={iconSrc} alt="" /> : icon ?? <CapabilityIcon id={cap!.id} size={20} />;

  const body = (
    <>
      <span
        className={`workspace-side-icon workspace-menu-icon${active ? ' is-active' : ''}`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span className="side-menu-label">{label}</span>
    </>
  );

  return (
    <div
      ref={anchorRef}
      className="side-menu-btn-wrap"
      onMouseEnter={() => cap && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => cap && setOpen(true)}
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
          onClick={() => {
            // The pointer stays over the rail after SPA navigation, so leaving
            // the preview open would cover the destination page's form.
            setOpen(false);
            onNavigate?.(path);
          }}
          className={`workspace-side-menu-btn${active ? ' active' : ''}`}
          aria-current={active ? 'page' : undefined}
        >
          {body}
        </Link>
      )}

      {open && anchorRef.current && cap && (
        <RailPreview
          anchor={anchorRef.current}
          title={label}
          imageUrl={previewImage ?? null}
          fallbackText={cap.sidebarHint ?? cap.summary}
        />
      )}
    </div>
  );
}
