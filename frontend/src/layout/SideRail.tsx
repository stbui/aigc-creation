import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Brush,
  Camera,
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
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { isCapabilityVisible, toolPath } from '../lib/capabilities';

/**
 * 侧边菜单。
 *
 * 响应式由 CSS 托管：>1366px 横排 / ≤1366px 垂直轨 / ≤900px 走抽屉。
 * 侧栏不提供 hover 提示或浮层，避免遮挡主区。
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
    'shoppable_carousel',
    'template',
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

/** 侧栏标签与能力注册表名称不一致的条目 */
const SIDEBAR_LABELS: Record<string, string> = {
  detail_image: '商品详情',
};

/** 菜单图标本地副本，运行时不请求外部资源 */
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
  template: Camera,
};

export function CapabilityIcon({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = ICONS[id] ?? Sparkles;
  return <Icon size={size} />;
}

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  activePath: string;
  onNavigate?: (to: string) => void;
}

export function SideRail({ groups, items, activePath, onNavigate }: Props) {
  const uid = useId();
  const location = useLocation();
  const activeLocation = `${location.pathname}${location.search}`;
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});
  /*
   * 菜单内容在 900px 高的视口上放不下（全部展开约 1164px），中间区是滚动容器。
   * macOS 默认 overlay 滚动条不滚动时不出现，截断处会像排版错误 —— 用底部渐隐
   * 提示「下面还有」。滚到底后立刻撤掉，不遮住最后一个入口。
   */
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  const syncSectionsOverflow = () => {
    const element = sectionsRef.current;
    if (!element) return;
    setHasMoreBelow(element.scrollHeight - element.scrollTop - element.clientHeight > 4);
  };

  useEffect(() => {
    syncSectionsOverflow();
    const element = sectionsRef.current;
    if (!element) return;
    window.addEventListener('resize', syncSectionsOverflow);
    return () => window.removeEventListener('resize', syncSectionsOverflow);
  }, [closedSections, groups, items]);

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
      active={toolIsActive(cap.id)}
      onNavigate={onNavigate}
    />
  );

  const dataCenterOpen = !closedSections.data_center;

  return (
    <nav className="app-sidebar" aria-label="侧边导航">
      <div
        ref={sectionsRef}
        className={`app-sidebar-sections${hasMoreBelow ? ' has-more' : ''}`}
        onScroll={syncSectionsOverflow}
      >
        <section className="app-sidebar-section is-open">
          <div className="app-sidebar-list">
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
          const panelId = `${uid}-app-sidebar-section-${group.id}`;
          return (
            <section key={group.id} className={`app-sidebar-section${open ? ' is-open' : ''}`}>
              <button
                type="button"
                className="app-sidebar-section-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggleSection(group.id)}
              >
                <span className="app-sidebar-section-label">{group.name}</span>
                <ChevronUp size={14} aria-hidden="true" />
              </button>
              {open && (
                <div id={panelId} className="app-sidebar-list">
                  {group.items.map(renderCapability)}
                </div>
              )}
            </section>
          );
        })}

        <section className={`app-sidebar-section${dataCenterOpen ? ' is-open' : ''}`}>
          {/* 数据看板是本地真实 IA 增强；素材库保持参考站命名与顺序。 */}
          <button
            type="button"
            className="app-sidebar-section-toggle"
            aria-expanded={dataCenterOpen}
            aria-controls={`${uid}-app-sidebar-section-data-center`}
            onClick={() => toggleSection('data_center')}
          >
            <span className="app-sidebar-section-label">数据中心</span>
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          {dataCenterOpen && (
            <div
              id={`${uid}-app-sidebar-section-data-center`}
              className="app-sidebar-list"
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

      <div className="app-sidebar-footer">
        <Link
          to="/tickets?type=other&compose=1&subject=%E4%BA%A7%E5%93%81%E5%BB%BA%E8%AE%AE"
          className="app-sidebar-footer-item app-sidebar-suggestion"
          onClick={() =>
            onNavigate?.(
              '/tickets?type=other&compose=1&subject=%E4%BA%A7%E5%93%81%E5%BB%BA%E8%AE%AE',
            )
          }
        >
          <span className="app-sidebar-footer-icon" aria-hidden="true">
            <MessageSquarePlus size={19} />
          </span>
          <span>产品建议</span>
        </Link>
        <Link
          to="/tickets?type=consultation&compose=1"
          className="app-sidebar-footer-item app-sidebar-service"
          onClick={() => onNavigate?.('/tickets?type=consultation&compose=1')}
        >
          <span className="app-sidebar-icon" aria-hidden="true">
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
}: {
  to?: string;
  label: string;
  icon?: ReactNode;
  iconSrc?: string;
  active: boolean;
  onNavigate?: (to: string) => void;
  cap?: CapabilityDef;
}) {
  const planned = cap?.mode === 'planned';
  const path = to ?? (planned ? '#' : toolPath(cap!.id));
  const glyph = iconSrc ? (
    <img src={iconSrc} alt="" />
  ) : (
    (icon ?? <CapabilityIcon id={cap!.id} size={20} />)
  );

  const body = (
    <>
      <span
        className={`app-sidebar-icon${active ? ' is-active' : ''}`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span className="app-sidebar-label">{label}</span>
    </>
  );

  return planned ? (
    <span
      className={`app-sidebar-item is-disabled${active ? ' is-active' : ''}`}
      aria-disabled
    >
      {body}
    </span>
  ) : (
    <Link
      to={path}
      onClick={() => onNavigate?.(path)}
      className={`app-sidebar-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {body}
    </Link>
  );
}
