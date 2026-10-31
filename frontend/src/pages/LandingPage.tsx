import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  Gift,
  Home,
  Images,
  LayoutDashboard,
  LogIn,
  Menu,
  MessageCircle,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  capabilityById,
  capabilityName,
  isCapabilityVisible,
  toolPath,
} from '../lib/capabilities';
import { useCapabilities } from '../hooks/useCapabilities';
import { PromoBar } from '../components/PromoBar';
import { useAuth } from '../context/AuthContext';
import { productsApi, membershipApi, myMarketingApi } from '../lib/api';
import { PLAN_VISUALS } from '../lib/constants';
import type { Product, MembershipPlan, PromoCampaign } from '../types/api';
import { useEffect } from 'react';

/**
 * 营销首页。
 *
 * 结构 (2026-10-31 改版, 类名前缀 `lp-`):
 *   1 首屏   左文案 + 双 CTA + 三条保障, 右 2x2 真实产出拼贴
 *   2 核心场景  商品主图 / 商品详情 / 爆款复刻 三张入口卡
 *   3 修图工具  8 个常用工具, 一屏内完成选择
 *   4 使用流程  上传 → 选能力 → 下载, 三步说明
 *   5 优秀案例  7 个分类平铺长式依次陈列, 每个分类 5 张, 不切页签
 *   6 套餐与积分 订阅 / 加油包 / 限时活动三个页签, 数据全部读接口
 *   7 产品特性  宽卡 + 两张补充卡
 *   8 底部行动区
 *
 * 与参考站的关系: 版面不再是逐像素复刻, 但商业内容 (套餐价目 / 案例图 / 客户 logo)
 * 仍来自 `frontend/public/landing/` 自托管资源; 价目、能力清单、活动一律读后端接口,
 * 页面不写死任何价格或能力数量。品牌标识保留本项目自有 (货觉AI)。
 */

/** 资源前缀: 全部落在 public/landing 下, 由 vite 原样拷贝 */
const A = '/landing';

interface BizCard {
  title: string;
  desc: string;
  img: string;
  icon: string;
  to: string;
  capability: string;
}

const BIZ_CARDS: BizCard[] = [
  {
    title: '商品主图',
    desc: '一键生成白底、场景、卖点等主图套图',
    img: `${A}/biz/商品套图.png`,
    icon: 'm_spzt',
    to: '/product-kit',
    capability: 'main_image',
  },
  {
    title: '商品详情',
    desc: '一键生成卖点、参数、细节等详情长图',
    img: `${A}/biz/商品详情.png`,
    icon: 'm_spxq',
    to: '/product-detail',
    capability: 'detail_image',
  },
  {
    title: '爆款复刻',
    desc: '一键复刻多张同款风格商品图',
    img: `${A}/biz/爆款复刻.png`,
    icon: 'm_bkfk',
    to: '/viral-clone',
    capability: 'hot_remake',
  },
];

interface ToolEntry {
  label: string;
  icon: string;
  to: string;
  capability: string;
}

const TOOL_ENTRIES: ToolEntry[] = [
  { label: '局部重绘', icon: 'm_jbch', to: '/local-redraw', capability: 'local_redraw' },
  { label: '一键抠图', icon: 'm_bjxc', to: '/background-remove', capability: 'matting' },
  { label: '去除水印', icon: 'm_qcsy', to: '/watermark-remove', capability: 'remove_watermark' },
  { label: '产品精修', icon: 'm_cpjx', to: '/product-retouch', capability: 'enhance' },
  { label: '图片翻译', icon: 'm_tpfy', to: '/image-translate', capability: 'image_translate' },
  { label: '智能扩图', icon: 'm_znkt', to: '/image-expand', capability: 'expand' },
  { label: '商品换色', icon: 'm_sphs', to: '/product-recolor', capability: 'recolor' },
  { label: '旋转角度', icon: 'm_jdxz', to: '/rotate-angle', capability: 'rotate' },
];

/** 顶部菜单与参考站 `/static/menu/*.svg` 对齐的本地图标。 */
const NAV_ICONS: Record<string, string> = {
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

/**
 * 加油包卡片图标。图标是**视觉资产**, 与定价无关, 故仍在前端按位置取 ——
 * 价目与积分数一律读 GET /products。
 *
 * ⚠ 2026-10-20 起本页不再硬编码加油包价目。此前写死的一组价
 * (¥19.90/100 积分) 与后台 seed-commerce 的 (¥9.90/500 积分) 单位成本差 10 倍,
 * 两套并存会让用户看到的价格与实付对不上。现在只认后端这一套。
 */
const ADDON_ICONS = ['icon_jcb', 'icon_bzb', 'icon_zyb', 'icon_qjb'];

/**
 * 首屏拼贴图 —— 取自案例库的真实产出, 不另外做示意图。
 * 访客在第一屏看到的是「能做出什么」, 而不是一段需要读三遍才懂的文案。
 */
const HERO_SHOTS = [
  { src: `${A}/case/spzt_01_1.png`, label: '白底主图' },
  { src: `${A}/case/spxqt_02_1.png`, label: '详情长图' },
  { src: `${A}/case/cpjx_03_1.png`, label: '产品精修' },
  { src: `${A}/case/cyst_04.png`, label: '创意场景' },
];

/** 使用流程三步: 固定文案, 不随接口变化 —— 这是产品口径, 不是商品数据 */
const FLOW_STEPS = [
  { icon: Upload, title: '上传商品图', desc: '拖入或选择本地图片，作为整套视觉的起点' },
  { icon: SlidersHorizontal, title: '选择能力与风格', desc: '白底、场景、卖点、详情，按需勾选组合' },
  { icon: Download, title: '下载成品', desc: '生成即入库，可在作品库继续复用与二创' },
];

/**
 * 案例文件按商品去重。
 *
 * 主图与详情图是成对产出 (`spzt_01_1` / `spzt_01_2`), 直接取前 5 张会
 * 让同一件商品出现两次, 案例墙看起来像重复黏贴。去掉配对后缀后按商品保留首张。
 */
function uniqueCaseFiles(files: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const key = file.replace(/\.[a-z]+$/i, '').replace(/_[12]$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

/**
 * 案例分组: key → 能力 + 文件名列表。
 * 首页按顺序平铺全部 7 个分类, 不再用页签切换 —— 访客一屏滚动就能看全能力覆盖。
 */
const CASE_GROUPS = [
  { key: 'spzt', capability: 'main_image', label: '商品主图', files: buildFiles('spzt', 16, 'png', 'jpg') },
  { key: 'spxqt', capability: 'detail_image', label: '商品详情图', files: buildFiles('spxqt', 16, 'png') },
  { key: 'bkfk', capability: 'hot_remake', label: '爆款复刻', files: buildFiles('bkfk', 8, 'png', undefined, 0) },
  { key: 'cyst', capability: 'free_create', label: '创意生图', files: buildFiles('cyst', 8, 'png', undefined, 0) },
  { key: 'cpjx', capability: 'enhance', label: '产品精修', files: buildFiles('cpjx', 16, 'png') },
  { key: 'yjkt', capability: 'matting', label: '一键抠图', files: buildFiles('yjkt', 16, 'png') },
  { key: 'xzjd', capability: 'rotate', label: '旋转角度', files: buildFiles('xzjd', 16, 'png') },
] as const;

/**
 * 生成案例文件名列表。
 * 双图制 (16 张): `spzt_01_1.png … spzt_08_2.png`, 末位可能为 .jpg;
 * 单图制 (8 张): `bkfk_01.png … bkfk_08.png` / `cyst_01.png … cyst_08.png` (pair=0)
 */
function buildFiles(prefix: string, count: number, ext: string, lastOverride?: string, pair = 1): string[] {
  const files: string[] = [];
  const pairs = count / 2;
  for (let i = 1; i <= (pair === 0 ? count : pairs); i += 1) {
    const n = String(i).padStart(2, '0');
    if (pair === 0) {
      files.push(`${prefix}_${n}.${ext}`);
    } else {
      files.push(`${prefix}_${n}_1.${ext}`);
      const isLast = i === pairs;
      const secondExt = isLast && lastOverride ? lastOverride : ext;
      files.push(`${prefix}_${n}_2.${secondExt}`);
    }
  }
  return files;
}

/**
 * 营销首页顶部导航 —— 复刻参考站 `.landing-topbar`（实拍 2026-10-17）:
 *   容器 1274x64 白底, padding `0 24px`, 相对定位 z10, grid + align-items center
 *   品牌 266x38 @24: logo 36x36 + 名称 16px #171A2B (padding `1px 6px`)
 *   左侧导航项 h32 / 13px / radius 8 / padding `0 14px`;
 *     首页为激活态 (54x32, #5546D8 + bg #F1EFFF), 其余 #667085 透明底
 *   下拉项 119x36 / 13px #475467 / radius 9 / padding `0 12px`
 *   右侧营销位为参考站的签到/新人礼包 → 改为如实标注「AI 创作 · 按能力计费」
 */
function LandingHeader() {
  const { data } = useCapabilities();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);

  // 落地页顶导与应用外壳同口径: 参考站 landing/workspace 共用同一套外壳, 3 个分组下拉齐全。
  // (旧注释「只展示两组 / 显式排除 ai_video」依据的是 10-17 旧快照, 已被 2026-10-19 实拍推翻)
  const navItems = (data?.items ?? []).filter(isCapabilityVisible);
  const navGroups = (data?.groups ?? []).filter((g) => navItems.some((i) => i.group === g.id));

  // 移动端 (≤900px) 导航抽屉: 落地页顶栏是自有实现, 不走应用外壳那套断点,
  // 390 实测原本把品牌+导航+算力胶囊+登录挤成 4 行。参考站 390 是「品牌 + 汉堡」,
  // 导航全进抽屉 —— 这里同构。
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(null);
      setMenuOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 901px)');
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    desktop.addEventListener('change', onBreakpointChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onBreakpointChange);
    };
  }, []);

  const toggleMobileMenu = () => {
    setOpen(null);
    setMenuOpen((value) => !value);
  };

  return (
    <>
      <PromoBar />
      <header className="landing-topbar">
        <Link to="/" className="landing-brand">
          {/* 品牌标记: 货觉AI「觉眼」logo (2026-10-19, 见 docs/brand/brand-basics.md) */}
          <img src="/brand/huojue-mark.svg" alt="货觉AI" className="landing-brand-mark" />
          <span className="landing-brand-text">
            货觉<span className="landing-brand-ai">AI</span>
          </span>
        </Link>
        <nav className={`landing-nav${open ? ' has-open-menu' : ''}`}>
          <Link to="/" className="landing-nav-item is-active">
            首页
          </Link>
          {navGroups.map((g) => (
            <div
              key={g.id}
              className={`landing-nav-group${open === g.id ? ' is-open' : ''}`}
              onMouseEnter={() => setOpen(g.id)}
              onMouseLeave={() => setOpen(null)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setOpen(null);
                }
              }}
            >
              <button
                type="button"
                className={`landing-nav-item${open === g.id ? ' is-open' : ''}`}
                aria-expanded={open === g.id}
                aria-haspopup="true"
                aria-controls={`landing-nav-menu-${g.id}`}
                onClick={() => setOpen(open === g.id ? null : g.id)}
              >
                {g.name}
                <ChevronDown size={13} className="landing-nav-chevron" />
              </button>
              <div className="landing-nav-menu" id={`landing-nav-menu-${g.id}`}>
                {navItems
                  .filter((i) => i.group === g.id)
                  .map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="landing-nav-menu-item"
                      title={i.summary}
                      onClick={() => {
                        setOpen(null);
                        navigate(toolPath(i.id));
                      }}
                    >
                      {NAV_ICONS[i.id] && (
                        <img src={NAV_ICONS[i.id]} alt="" aria-hidden loading="lazy" />
                      )}
                      <span className="landing-nav-menu-name">{i.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <Link to="/workbench" className="landing-nav-item">
            工作台
          </Link>
        </nav>
        <div className="landing-topbar-right">
          <span className="landing-quota-pill">AI 创作 · 按能力计费</span>
          <Link to="/works" className="landing-nav-item">
            我的作品
          </Link>
          <Link to="/stats" className="landing-nav-item">
            数据中心
          </Link>
          {token ? (
            <Link to="/workbench" className="landing-account">
              进入工作台
            </Link>
          ) : (
            <Link to="/login" className="landing-account">
              登录/注册
            </Link>
          )}
        </div>
        {/* 汉堡必须是 header 的直系子元素: 放在 .landing-topbar-right 里会随该容器
            在 ≤900px 一起 display:none, 按钮永远点不到 (2026-10-19 实测踩到) */}
        <button
          type="button"
          className="landing-mobile-toggle"
          aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
          onClick={toggleMobileMenu}
        >
          <Menu size={20} />
        </button>
        <nav
          id="landing-mobile-menu"
          className={`landing-mobile-menu${menuOpen ? ' is-open' : ''}`}
          aria-label="移动端导航"
          aria-hidden={!menuOpen}
        >
          <section className="landing-mobile-section">
            <span className="landing-mobile-section-title">快捷入口</span>
            <div className="landing-mobile-grid">
              <Link to="/" className="landing-mobile-item is-active" onClick={closeMenu}>
                <Home size={18} aria-hidden />
                <span>首页</span>
              </Link>
              <Link to="/workbench" className="landing-mobile-item" onClick={closeMenu}>
                <LayoutDashboard size={18} aria-hidden />
                <span>工作台</span>
              </Link>
              <Link to="/works" className="landing-mobile-item" onClick={closeMenu}>
                <Images size={18} aria-hidden />
                <span>我的作品</span>
              </Link>
            </div>
          </section>
          {navGroups.map((g) => (
            <section key={g.id} className="landing-mobile-section">
              <span className="landing-mobile-section-title">{g.name}</span>
              <div className="landing-mobile-grid">
                {navItems
                  .filter((i) => i.group === g.id)
                  .map((i) => (
                    <Link
                      key={i.id}
                      to={toolPath(i.id)}
                      className="landing-mobile-item"
                      onClick={closeMenu}
                    >
                      {NAV_ICONS[i.id] && (
                        <img src={NAV_ICONS[i.id]} alt="" aria-hidden loading="lazy" />
                      )}
                      <span>{i.name}</span>
                    </Link>
                  ))}
              </div>
            </section>
          ))}
          <section className="landing-mobile-section">
            <span className="landing-mobile-section-title">账户服务</span>
            <div className="landing-mobile-grid">
              <Link to="/packages" className="landing-mobile-item" onClick={closeMenu}>
                <CreditCard size={18} aria-hidden />
                <span>购买套餐</span>
              </Link>
              <Link to="/invitations" className="landing-mobile-item" onClick={closeMenu}>
                <Gift size={18} aria-hidden />
                <span>邀请好友</span>
              </Link>
              <Link
                to="/tickets?type=consultation&compose=1"
                className="landing-mobile-item"
                onClick={closeMenu}
              >
                <MessageCircle size={18} aria-hidden />
                <span>联系客服</span>
              </Link>
              <Link
                to={token ? '/workbench' : '/login'}
                className="landing-mobile-item"
                onClick={closeMenu}
              >
                <LogIn size={18} aria-hidden />
                <span>{token ? '进入工作台' : '登录/注册'}</span>
              </Link>
            </div>
          </section>
        </nav>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="landing-mobile-scrim"
          aria-label="关闭导航菜单"
          onClick={closeMenu}
        />
      )}
    </>
  );
}

/** 活动结束时间展示（本地时区，仅展示用，不参与任何判定） */
function formatCampaignEnd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LandingPage() {
  const navigate = useNavigate();
  const { data: capabilityData } = useCapabilities();
  const [pkgTab, setPkgTab] = useState<'sub' | 'addon' | 'campaign'>('sub');
  /**
   * 进行中的限时活动。页签**只在真有活动时出现** ——
   * 此前这里是写死的「双节上新」禁用页签，永远点不开也永远没有内容。
   */
  const [campaigns, setCampaigns] = useState<PromoCampaign[]>([]);
  /** 加油包: 读后端 SKU。拉不到时如实留空, 不回落硬编码价 */
  const [addons, setAddons] = useState<Product[]>([]);
  /** 订阅套餐: 读后端 MembershipPlan, 同样不回落硬编码 */
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  /**
   * 两个价目接口各自的加载/失败状态 (2026-10-20 修)。
   *
   * 此前失败与"加载中"共用 `length === 0` 一个判断, 失败后页面会**永久**
   * 显示「套餐加载中…」—— 接口早就挂了, 用户看到的却是一个永远转不完的等待。
   * 加载中 / 加载失败 / 没有该商品 三者必须分开。
   */
  const [plansState, setPlansState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [addonsState, setAddonsState] = useState<'loading' | 'error' | 'ready'>('loading');

  useEffect(() => {
    let alive = true;
    // 两个价目接口互不依赖, 一个失败不该拖垮另一个
    productsApi
      .list()
      .then((list) => {
        if (!alive) return;
        setAddons(list);
        setAddonsState('ready');
      })
      .catch(() => {
        // 拉不到就显示为空态 —— 落地页不该因为一个接口挂了就整页崩掉,
        // 也不该回落硬编码价 (那正是本次要消灭的第二套价目)
        if (!alive) return;
        setAddons([]);
        setAddonsState('error');
      });
    membershipApi
      .plans()
      .then((list) => {
        if (!alive) return;
        setPlans(list);
        setPlansState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setPlans([]);
        setPlansState('error');
      });
    // 限时活动: 失败就当没有活动（页签不出现），不弹错 —— 落地页不该为促销位报错
    myMarketingApi
      .campaigns()
      .then((list) => {
        if (alive) setCampaigns(list);
      })
      .catch(() => {
        if (alive) setCampaigns([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 首页入口同样跟随能力运行时状态。
   *
   * 能力清单未到达（或请求失败）时保留全部入口：首页是公开首屏，不能因为
   * 一次清单抖动就整块消失。清单到达后再把运营下线的能力隐藏。
   */
  const visibleCapabilityIds = useMemo(() => {
    if (!capabilityData) return null;
    return new Set(capabilityData.items.filter(isCapabilityVisible).map((c) => c.id));
  }, [capabilityData]);
  const bizCards = visibleCapabilityIds
    ? BIZ_CARDS.filter((b) => visibleCapabilityIds.has(b.capability))
    : BIZ_CARDS;
  const toolEntries = visibleCapabilityIds
    ? TOOL_ENTRIES.filter((t) => visibleCapabilityIds.has(t.capability))
    : TOOL_ENTRIES;
  /** 首屏文案里的能力数: 取运行时可见能力; 清单未到达时按项目声明数兜底 */
  const totalCapabilities = visibleCapabilityIds?.size ?? 16;

  // 案例分组与商品卡、工具入口同口径：运营下线的能力整组不再展示。
  const caseGroups = useMemo(
    () =>
      visibleCapabilityIds
        ? CASE_GROUPS.filter((g) => visibleCapabilityIds.has(g.capability))
        : CASE_GROUPS,
    [visibleCapabilityIds],
  );

  /** 案例卡点击: 跳对应工具页 (未登录能力走工具页, 由 App 层鉴权兜底) */
  const caseTarget = (key: string) => {
    const map: Record<string, string> = {
      spzt: 'main_image',
      spxqt: 'detail_image',
      bkfk: 'hot_remake',
      cyst: 'free_create',
      cpjx: 'enhance',
      yjkt: 'matting',
      xzjd: 'rotate',
    };
    const def = capabilityById(map[key] ?? '');
    // 必须复用统一路径映射：手拼 /tools/:id 会让商品主图/详情图等
    // 自定义工作台退化到通用工具页，用户看不到对应的专属表单。
    return def ? toolPath(def.id) : '/workbench';
  };

  return (
    <div className="landing-page" data-route-stage>
      <LandingHeader />

      {/* ── 1. 首屏: 左文案 / 右真实产出拼贴 ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <Sparkles size={13} aria-hidden />
              货觉AI · {totalCapabilities} 项电商视觉能力
            </span>
            <h1>
              一张商品图
              <br />
              <em>出全套电商视觉</em>
            </h1>
            <p className="lp-hero-sub">
              白底主图、场景图、卖点图、详情长图与修图工具，全部在同一个工作台完成。
              真实模型生成，按能力计费。
            </p>
            <div className="lp-hero-actions">
              <button
                type="button"
                className="lp-btn lp-btn-primary"
                onClick={() => navigate(bizCards[0]?.to ?? '/workbench')}
              >
                免费开始创作
                <ArrowRight size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="lp-btn lp-btn-ghost"
                onClick={() => navigate('/packages')}
              >
                查看套餐价目
              </button>
            </div>
            <ul className="lp-hero-proof">
              <li>
                <Check size={14} aria-hidden />
                真实模型产出
              </li>
              <li>
                <Check size={14} aria-hidden />
                失败原额退还
              </li>
              <li>
                <Check size={14} aria-hidden />
                生成即入库
              </li>
            </ul>
          </div>
          <div className="lp-hero-visual" aria-hidden>
            {HERO_SHOTS.map((shot, i) => (
              <figure key={shot.src} className={`lp-hero-shot is-${i + 1}`}>
                <img src={shot.src} alt="" loading={i < 2 ? 'eager' : 'lazy'} />
                <figcaption>{shot.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. 核心场景 ── */}
      <section className="lp-section">
        <header className="lp-section-head">
          <span className="lp-kicker">核心场景</span>
          <h2>从一张商品图，到一整套视觉</h2>
          <p>主图、详情、爆款复刻三条主线，覆盖上新与投放的主要构图需求。</p>
        </header>
        <div className="lp-scene-grid">
          {bizCards.map((b) => (
            <article key={b.title} className="lp-scene-card">
              <div className="lp-scene-media">
                <img src={b.img} alt={b.title} loading="lazy" />
              </div>
              <div className="lp-scene-body">
                <h3>
                  <img
                    className="lp-scene-icon"
                    src={`${A}/icons/${b.icon}.svg`}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                  />
                  {b.title}
                </h3>
                <p>{b.desc}</p>
                <button type="button" className="lp-scene-link" onClick={() => navigate(b.to)}>
                  开始生成
                  <ArrowRight size={14} aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── 3. 修图工具 ── */}
      <section className="lp-section lp-section-tight">
        <div className="lp-tools-head">
          <div>
            <span className="lp-kicker">修图工具</span>
            <h2>日常修图，一个入口</h2>
          </div>
          <Link to="/workbench" className="lp-text-link">
            全部工具
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="lp-tool-grid">
          {toolEntries.map((t) => (
            <button key={t.label} type="button" className="lp-tool" onClick={() => navigate(t.to)}>
              <img src={`${A}/icons/${t.icon}.svg`} alt="" aria-hidden loading="lazy" decoding="async" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. 使用流程 ── */}
      <section className="lp-section lp-section-tight">
        <div className="lp-flow-panel">
          {FLOW_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="lp-step">
                <span className="lp-step-index">0{i + 1}</span>
                <div className="lp-step-copy">
                  <h3>
                    <Icon size={16} aria-hidden />
                    {step.title}
                  </h3>
                  <p>{step.desc}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── 5. 优秀案例: 7 个分类平铺长式, 不切页签 ── */}
      {caseGroups.length > 0 && (
        <section className="lp-section">
          <div className="lp-cases-head">
            <div>
              <span className="lp-kicker">优秀案例</span>
              <h2>看看工具能做出什么</h2>
            </div>
          </div>
          {/* 每个分类按商品去重后只陈列 5 张: 分类全部展开,
              访客不必猜「别的能力能不能做」—— 只是把库存图墙换成 7 段短条 */}
          <div className="lp-case-groups">
            {caseGroups.map((group) => {
              const target = caseTarget(group.key);
              return (
                <article className="lp-case-group" key={group.key}>
                  <header className="lp-case-group-head">
                    <h3>{group.label}</h3>
                    <button type="button" className="lp-text-link" onClick={() => navigate(target)}>
                      做同款
                      <ArrowRight size={14} aria-hidden />
                    </button>
                  </header>
                  <div className="lp-case-strip">
                    {uniqueCaseFiles(group.files).slice(0, 5).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className="lp-case-card"
                        aria-label={`${group.label}示例，做同款`}
                        onClick={() => navigate(target)}
                      >
                        <img src={`${A}/case/${f}`} alt={group.label} loading="lazy" />
                        <span className="lp-case-label">做同款</span>
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 6. 套餐与积分 ── */}
      <section className="lp-section" id="packages">
        <div className="lp-packages-head">
          <div>
            <span className="lp-kicker">套餐与积分</span>
            <h2>按需订阅，或随时加油</h2>
            <p>订阅套餐每月发放积分；积分包一次购买，有效期以卡片标注为准。</p>
          </div>
          <Link to="/packages" className="lp-text-link">
            进入积分商城
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="lp-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={pkgTab === 'sub'}
            className={pkgTab === 'sub' ? 'is-active' : ''}
            onClick={() => setPkgTab('sub')}
          >
            订阅套餐
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pkgTab === 'addon'}
            className={pkgTab === 'addon' ? 'is-active' : ''}
            onClick={() => setPkgTab('addon')}
          >
            加油包
          </button>
          {campaigns.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={pkgTab === 'campaign'}
              className={pkgTab === 'campaign' ? 'is-active' : ''}
              onClick={() => setPkgTab('campaign')}
            >
              限时活动
            </button>
          )}
        </div>
        <div className="lp-packages-body">
          {pkgTab === 'sub' ? (
            <div className="lp-plan-grid">
              {plansState === 'loading' && (
                <p className="lp-empty">套餐加载中…</p>
              )}
              {plansState === 'error' && (
                <p className="lp-empty">套餐暂时加载失败，请稍后刷新查看</p>
              )}
              {plansState === 'ready' && plans.filter((p) => p.durationDays > 0).length === 0 && (
                <p className="lp-empty">暂无可用套餐</p>
              )}
              {plans.filter((plan) => plan.durationDays > 0).map((plan, i) => {
                const visual = PLAN_VISUALS[i];
                return (
                  <article
                    key={plan.id}
                    className={`lp-plan-card${visual?.recommended ? ' is-recommended' : ''}`}
                  >
                    {visual?.tag && (
                      <span className={`lp-plan-tag${visual.recommended ? ' is-hot' : ''}`}>
                        {visual.tag}
                      </span>
                    )}
                    <h3>{plan.name}</h3>
                    <div className="lp-plan-price">
                      <span className="cur">¥</span>
                      <strong>{(plan.priceCents / 100).toFixed(2)}</strong>
                      <em>/ {plan.durationDays} 天</em>
                    </div>
                    <p className="lp-plan-credits">
                      {plan.monthlyCredits.toLocaleString('zh-CN')} 积分 / 月
                    </p>
                    {/* 权益文案由后端 buildPerkLabels 生成 —— 改权益只需改一处,
                        不会出现「宣传页写的和实际给的不一样」 */}
                    <ul className="lp-plan-perks">
                      {plan.perkLabels.map((f) => (
                        <li key={f}>
                          <Check size={13} aria-hidden />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {/*
                     * 订阅购买走订单+支付链路: MembershipPlan 不在 Product 表里,
                     * 下单时走 `membershipPlanId`, 与积分包同一条支付通道。
                     */}
                    <button
                      type="button"
                      className="lp-plan-buy"
                      onClick={() => navigate(`/checkout/membership?planId=${encodeURIComponent(plan.id)}`)}
                    >
                      立即订阅
                    </button>
                  </article>
                );
              })}
            </div>
          ) : pkgTab === 'addon' ? (
            <div className="lp-addon-grid">
              {addonsState === 'loading' && (
                <p className="lp-empty">积分包加载中…</p>
              )}
              {addonsState === 'error' && (
                <p className="lp-empty">积分包暂时加载失败，请稍后刷新查看</p>
              )}
              {addonsState === 'ready' && addons.length === 0 && (
                <p className="lp-empty">暂无可用积分包</p>
              )}
              {/*
               * 首页只陈列前 4 款 (一行), 全量 15 款在 `/packages` ——
               * 首页是入口不是价目表, 15 张卡会把落地页拉成第二个商城。
               */}
              {addons.slice(0, 4).map((p, i) => (
                <article key={p.id} className="lp-addon-card">
                  {ADDON_ICONS[i] && (
                    <img
                      className="lp-addon-icon"
                      src={`${A}/icons/${ADDON_ICONS[i]}.svg`}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <h3>{p.name}</h3>
                  <div className="lp-addon-price">
                    {p.isFree ? (
                      <strong>免费</strong>
                    ) : (
                      <>
                        <span className="cur">¥</span>
                        <strong>{(p.priceCents / 100).toFixed(2)}</strong>
                        {p.originalPriceCents && p.originalPriceCents > p.priceCents && (
                          <del>¥{(p.originalPriceCents / 100).toFixed(2)}</del>
                        )}
                      </>
                    )}
                  </div>
                  {/*可生成张数不写死「积分 ÷ 10」—— 实际每次扣多少以能力消耗价为准,
                      与生成页显示的同一个数, 免得两处算法漂移 */}
                  <p className="lp-addon-meta">
                    {p.credits.toLocaleString('zh-CN')} 积分 ·{' '}
                    {p.creditsValidDays > 0 ? `${p.creditsValidDays} 天内有效` : '永久有效'}
                  </p>
                  <button
                    type="button"
                    className="lp-plan-buy"
                    onClick={() => navigate('/packages')}
                  >
                    {p.isFree ? '免费领取' : '立即购买'}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            /*
             * 限时活动：全部来自后台「限时活动」配置（`GET /marketing/campaigns`）。
             * 过期 / 下架商品 / 活动价不低于原价的活动后端已过滤，这里不做二次判断 ——
             * 展示层再算一遍价格就会出现「页面写 9.9、结算收 19.9」。
             */
            <div className="lp-addon-grid">
              {campaigns.map((c) =>
                c.type === 'limited_price' && c.product && typeof c.priceCents === 'number' ? (
                  <article key={c.id} className="lp-addon-card is-campaign">
                    <span className="lp-campaign-tag">限时价</span>
                    <h3>{c.product.name}</h3>
                    <div className="lp-addon-price">
                      <span className="cur">¥</span>
                      <strong>{(c.priceCents / 100).toFixed(2)}</strong>
                      <del>¥{(c.product.priceCents / 100).toFixed(2)}</del>
                    </div>
                    <p className="lp-addon-meta">
                      {c.name} · {formatCampaignEnd(c.endAt)}结束
                    </p>
                    <button
                      type="button"
                      className="lp-plan-buy"
                      onClick={() => navigate(`/checkout/${encodeURIComponent(c.product!.sku)}`)}
                    >
                      立即抢购
                    </button>
                  </article>
                ) : (
                  <article key={c.id} className="lp-addon-card is-campaign">
                    <span className="lp-campaign-tag">限时免费</span>
                    <h3>{c.name}</h3>
                    <div className="lp-addon-price">
                      <strong>0</strong>
                      <span>积分</span>
                    </div>
                    <p className="lp-addon-meta">
                      {(c.capabilityIds ?? []).map((id) => capabilityName(id)).join(' / ')}
                      <br />
                      {formatCampaignEnd(c.endAt)}结束
                    </p>
                    <button
                      type="button"
                      className="lp-plan-buy"
                      onClick={() => {
                        const first = c.capabilityIds?.[0];
                        navigate(first ? toolPath(first) : '/workbench');
                      }}
                    >
                      去使用
                    </button>
                  </article>
                ),
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── 7. 产品特性 ── */}
      <section className="lp-section">
        <header className="lp-section-head is-center">
          <span className="lp-kicker">产品特性</span>
          <h2>为电商而生的 AI 作图工作台</h2>
          <p>上传、生成、下载，全流程在同一个页面完成。</p>
        </header>
        <article className="lp-feature-wide">
          <div className="lp-feature-copy">
            <h3>一张商品图，搞定全套图</h3>
            <ul>
              <li>省下布景、拍摄、修图的重复成本</li>
              <li>一张图延展多套视觉，快速测试点击率</li>
              <li>风格统一，适合店铺、广告、详情页同步使用</li>
            </ul>
            <button type="button" className="lp-btn lp-btn-primary" onClick={() => navigate('/product-kit')}>
              去试试
              <ArrowRight size={15} aria-hidden />
            </button>
          </div>
          <div className="lp-feature-media">
            {/* 参考站该区是 banner 背景图内嵌, 本项目改用真实产出拼贴(诚实替代)。
                网格为 4 列 2 行: 主图跨 2x2 占 4 格, 余 4 格各放一张 → 共 5 张, 不留空行 */}
            <img className="lp-feature-main" src={`${A}/feat/top_01.png`} alt="" loading="lazy" />
            <img src={`${A}/feat/left_01.png`} alt="" loading="lazy" />
            <img src={`${A}/feat/right_02.png`} alt="" loading="lazy" />
            <img src={`${A}/feat/top_02.png`} alt="" loading="lazy" />
            <img src={`${A}/feat/top_03.png`} alt="" loading="lazy" />
          </div>
        </article>
        <div className="lp-feature-grid">
          <article className="lp-feature-card">
            <h3>一键生成完整的电商详情图组</h3>
            <ul>
              <li>把参数和卖点转成可视化内容</li>
              <li>模块化输出，方便直接排版落地</li>
              <li>提升页面完整度，减少设计制作时间</li>
            </ul>
            <button type="button" className="lp-text-link" onClick={() => navigate('/product-detail')}>
              去试试
              <ArrowRight size={14} aria-hidden />
            </button>
          </article>
          <article className="lp-feature-card">
            <h3>复刻爆款图的设计风格</h3>
            <ul>
              <li>拆解爆款视觉逻辑，降低试错成本</li>
              <li>跟款上新更快，趋势不掉队</li>
              <li>保留原图氛围，替换主体不违和</li>
            </ul>
            <button type="button" className="lp-text-link" onClick={() => navigate('/viral-clone')}>
              去试试
              <ArrowRight size={14} aria-hidden />
            </button>
          </article>
        </div>
      </section>

      {/* ── 8. 底部行动区 ── */}
      <section className="lp-cta">
        <div className="lp-cta-inner">
          <h2>现在开始，用一张图做完一套图</h2>
          <p>注册即用，按能力计费，生成失败原额退还。</p>
          <button
            type="button"
            className="lp-btn lp-btn-on-brand"
            onClick={() => navigate(bizCards[0]?.to ?? '/workbench')}
          >
            免费开始创作
            <ArrowRight size={16} aria-hidden />
          </button>
        </div>
      </section>

      {/* ── 9. 页脚 ── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <strong>货觉AI · 电商视觉创作平台</strong>
            <p>好图，好卖 —— 商品图 · 详情页 · 营销视觉，一站生成</p>
            <div className="landing-footer-logos">
              <img src={`${A}/logos/t_y01.png`} alt="客户 logo" loading="lazy" />
              <img src={`${A}/logos/t_y02.png`} alt="客户 logo" loading="lazy" />
              <img src={`${A}/logos/t_y03.png`} alt="客户 logo" loading="lazy" />
            </div>
          </div>
          <div className="landing-footer-col">
            <h4>AI工具</h4>
            <Link to="/product-kit">商品主图</Link>
            <Link to="/viral-clone">爆款复刻</Link>
            <Link to="/workbench">更多工具</Link>
          </div>
          <div className="landing-footer-col">
            <h4>积分套餐</h4>
            <Link to="/packages">积分购买</Link>
            <Link to="/credits">积分明细</Link>
            <Link to="/works">任务记录</Link>
          </div>
          <div className="landing-footer-col">
            <h4>支持与服务</h4>
            <Link to="/tickets?type=consultation&compose=1">帮助中心</Link>
            <Link to="/legal/user-agreement.html">用户协议</Link>
            <Link to="/legal/privacy-policy.html">隐私政策</Link>
            <Link to="/tickets?type=complaint&compose=1">投诉举报</Link>
          </div>
        </div>
        <p className="landing-footer-copy">
          © 2026 货觉AI · 页面用于产品展示，案例素材版权归各自权利人所有。
        </p>
      </footer>
    </div>
  );
}
