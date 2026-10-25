import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Menu } from 'lucide-react';
import { Drawer } from 'antd';
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
import type { Product, MembershipPlan, PromoCampaign } from '../types/api';
import { useEffect } from 'react';

/**
 * 营销首页 —— 1:1 复刻参考站 https://ijihua.cn/ (landing-page)。
 *
 * 版面数值来自参考站 computed styles 实拍 (2026-10-17, 1280 视口, 关掉 guest-promo 弹窗后):
 *   hero        .home-v2-hero        1274x238, padding `64px 24px 48px`
 *               背景 = 双层渐变 (linear-gradient(#F6F7FB 透明→实色 72%→100%) 叠 90deg 三段紫蓝)
 *               h1 40px/500 #171A2B lh63 居中; p 17px #667085 lh31 居中
 *   businesses  .home-v2-businesses  1274x339, padding `0 24px 16px`
 *               grid 3 列 389.3px gap16; 卡片 389x323 白底 radius 24 padding 24
 *               标题 18px/500 #171A2B; 说明 14px #667085; CTA 103x34 #6C5CE7 radius 8 13px
 *   tools       .home-v2-tools       1274x272, padding `0 24px 32px`
 *               grid 4 列 276px gap16; 卡片 276x88 #F2F4F7 radius 8 padding `24px 40px`
 *               图标 24x24 object-fit contain
 *   packages    .home-v2-packages    1274x673, padding `0 24px 32px`, column gap 32
 *               段标题 1200x62 (h2 24px/700 #171A2B + 副标 16px #667085)
 *               tabs 328x38 胶囊 (底 #E4E7EF radius 999 padding 3); 价格 32px/700 #333
 *   cases       .home-v2-cases       1274x1003, padding `32px 24px`, column gap 32
 *               h2 24px/700 #171A2B (左对齐); tabs 614x53; grid 4 列 288px gap16
 *               卡片 288x384 #F3F4F6 radius 16 overflow hidden; 图 288x384 object-fit cover (600/800)
 *   features    .home-v2-features    1274x1042, padding `32px 24px`, column gap 32
 *               wide 1200x541 白底 radius 24 padding 24, grid `400px 728px` gap 24
 *               grid 2 列 592px gap16; 卡片 592x311 白底 radius 24 padding 24
 *   footer      .landing-footer      1274x264 白底 padding `32px 32px 28px`
 *
 * 路由对齐: 参考站 `/` 是营销首页、工作台在 `/workbench`; 本项目同步该结构。
 * 商业内容 (套餐价目 / 案例图 / 客户 logo / 营销文案) 按用户 2026-10-17 决策「完全照搬」,
 * 资源已下载到 `frontend/public/landing/` 自托管 (不热链第三方 CDN)。
 * 品牌标识保留本项目自有 (货觉AI, 2026-10-19 定名), 不替换为参考站商标。
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

/**
 * 订阅套餐静态描述 (**仅视觉, 不含价格**)。
 *
 * ⚠ 2026-10-20 重大变更: 订阅卡价格与积分数改为读后端 `/membership/plans`。
 * 此前整组价目写死在本页 (周卡 9.90 / 月卡 39.90 / 季卡 109 / 年卡 359),
 * 与商品表完全是两套事实源 —— 改价要同时改两处, 漏一处就展示与实付不一致。
 *
 * 「推荐 / 标签 / 副标题」属视觉资产, 留在前端; **价格与积分一律读接口**。
 */
/**
 * 订阅套餐的**视觉**信息 (标签 / 推荐位), 按 sortOrder 顺序与后端套餐一一对应。
 *
 * ⚠ 2026-10-20 重大变更: 订阅卡价格与积分数改为读后端 `/membership/plans`。
 * 此前整组价目写死在本页 (周卡 9.90 / 月卡 39.90 / 季卡 109 / 年卡 359),
 * 与会员表完全是两套事实源 —— 改价要同时改两处, 漏一处就展示与实付不一致。
 *
 * 刻意**不按 code 匹配**: 后端套餐 code 由 seed 定义 (basic/pro/studio),
 * 前端硬编码 code 等于把后端标识抄一份, 后台改了 code 这边就静默错位。
 * 只保留视觉顺序, 内容一律取接口值。
 */
const PACKAGE_VISUALS = [
  { tag: '体验尝鲜', recommended: false },
  { tag: '热门', recommended: false },
  { tag: '推荐', recommended: true },
  { tag: '年卡', recommended: false },
];

/**
 * 加油包卡片图标。图标是**视觉资产**, 与定价无关, 故仍在前端按位置取 ——
 * 价目与积分数一律读 GET /products。
 *
 * ⚠ 2026-10-20 起本页不再硬编码加油包价目。此前写死的一组价
 * (¥19.90/100 积分) 与后台 seed-commerce 的 (¥9.90/500 积分) 单位成本差 10 倍,
 * 两套并存会让用户看到的价格与实付对不上。现在只认后端这一套。
 */
const ADDON_ICONS = ['icon_jcb', 'icon_bzb', 'icon_zyb', 'icon_qjb'];

/** 案例 tab: key → 图片前缀与文件名列表 (实拍自参考站 case-tab 切换) */
const CASE_TABS = [
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
        <nav className="landing-nav">
          <Link to="/" className="landing-nav-item is-active">
            首页
          </Link>
          {navGroups.map((g) => (
            <div
              key={g.id}
              className="landing-nav-group"
              onMouseEnter={() => setOpen(g.id)}
              onMouseLeave={() => setOpen(null)}
            >
              <button
                type="button"
                className={`landing-nav-item${open === g.id ? ' is-open' : ''}`}
                aria-expanded={open === g.id}
                onClick={() => setOpen(open === g.id ? null : g.id)}
              >
                {g.name}
                <ChevronDown size={13} />
              </button>
              {open === g.id && (
                <div className="landing-nav-menu">
                  {navItems
                    .filter((i) => i.group === g.id)
                    .map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className="landing-nav-menu-item"
                        onClick={() => {
                          setOpen(null);
                          navigate(toolPath(i.id));
                        }}
                      >
                        <span className="landing-nav-menu-name">{i.name}</span>
                        <span className="landing-nav-menu-sum">{i.summary}</span>
                      </button>
                    ))}
                </div>
              )}
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
          aria-label="打开导航菜单"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={20} />
        </button>
      </header>

      {/* 移动端导航抽屉 (≤900px 顶栏只留品牌 + 汉堡, 参考站 390 同构) */}
      <Drawer
        title="导航菜单"
        placement="right"
        size={300}
        open={menuOpen}
        onClose={closeMenu}
        className="landing-mobile-drawer"
        styles={{ body: { padding: 0 } }}
      >
        <nav className="landing-mobile-nav" aria-label="移动端导航">
          <Link to="/" className="landing-mobile-item" onClick={closeMenu}>
            首页
          </Link>
          {navGroups.map((g) => (
            <div key={g.id} className="landing-mobile-group">
              <span className="landing-mobile-group-title">{g.name}</span>
              {navItems
                .filter((i) => i.group === g.id)
                .map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="landing-mobile-item"
                    onClick={() => {
                      closeMenu();
                      navigate(toolPath(i.id));
                    }}
                  >
                    {i.name}
                  </button>
                ))}
            </div>
          ))}
          <div className="landing-mobile-group">
            <span className="landing-mobile-group-title">账户与工具</span>
            <Link to="/works" className="landing-mobile-item" onClick={closeMenu}>
              我的作品
            </Link>
            <Link to="/packages" className="landing-mobile-item" onClick={closeMenu}>
              购买套餐
            </Link>
            <Link to="/invitations" className="landing-mobile-item" onClick={closeMenu}>
              邀请有奖
            </Link>
            <Link to="/stats" className="landing-mobile-item" onClick={closeMenu}>
              数据中心
            </Link>
            <Link
              to="/tickets?type=consultation&compose=1"
              className="landing-mobile-item"
              onClick={closeMenu}
            >
              联系客服
            </Link>
          </div>
        </nav>
      </Drawer>
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
  const [caseTab, setCaseTab] = useState<string>(CASE_TABS[0].key);

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

  // 案例页签与商品卡、工具入口同口径：运营下线的能力不再展示案例 CTA。
  const caseTabs = useMemo(
    () =>
      visibleCapabilityIds
        ? CASE_TABS.filter((t) => visibleCapabilityIds.has(t.capability))
        : CASE_TABS,
    [visibleCapabilityIds],
  );
  const activeCase = useMemo(
    () => caseTabs.find((t) => t.key === caseTab) ?? caseTabs[0] ?? null,
    [caseTabs, caseTab],
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
    <div className="landing-page">
      <LandingHeader />

      {/* ── 1. hero ── */}
      <section className="home-v2-hero">
        {/* 营销文案按 2026-10-17「完全照搬」决策保留, 但品牌名必须是自有品牌:
            原标题带参考站商标「极画AI」, 与 README「保留本项目自有品牌标识, 不替换为参考站商标」冲突,
            2026-10-19 统一为货觉AI (见 docs/brand/brand-basics.md) */}
        <h1>货觉AI电商图 上新快10倍 拍图成本直降90%</h1>
        <p>上传商品图，一键生成白底图、场景图、卖点图、详情页全套电商图</p>
      </section>

      {/* ── 2. 业务场景 ── */}
      <section className="home-v2-businesses">
        <div className="home-v2-business-grid">
          {bizCards.map((b) => (
            <article key={b.title} className="home-v2-business-card">
              <div className="home-v2-business-media">
                <img src={b.img} alt={b.title} loading="lazy" />
              </div>
              <div className="home-v2-business-copy">
                <h3>
                  <img className="home-v2-business-icon" src={`${A}/icons/${b.icon}.svg`} alt="" aria-hidden loading="lazy" decoding="async" />
                  {b.title}
                </h3>
                <p>{b.desc}</p>
                <button type="button" className="home-v2-cta" onClick={() => navigate(b.to)}>
                  开始生成
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── 3. 修图工具入口 ── */}
      <section className="home-v2-tools">
        <div className="home-v2-tool-grid">
          {toolEntries.map((t) => (
            <button key={t.label} type="button" className="home-v2-tool-card" onClick={() => navigate(t.to)}>
              <img src={`${A}/icons/${t.icon}.svg`} alt="" aria-hidden loading="lazy" decoding="async" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. 套餐与加油包 ── */}
      <section className="home-v2-packages" id="packages">
        <button
          type="button"
          className="home-v2-packages-entry"
          onClick={() => navigate('/packages')}
          title="进入积分商城（1:1 复刻参考站 /packages）"
        >
          进入积分商城 →
        </button>
        <div className="home-v2-section-heading">
          <h2>套餐与加油包</h2>
          <p>选择适合你的订阅套餐，解锁周期会员权益</p>
        </div>
        <div className="home-v2-package-tabs" role="tablist">
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
        <div className="home-v2-package-scroller">
          {pkgTab === 'sub' ? (
            <div className="home-v2-package-row">
              {plansState === 'loading' && (
                <p className="home-v2-addon-empty">套餐加载中…</p>
              )}
              {plansState === 'error' && (
                <p className="home-v2-addon-empty">套餐暂时加载失败，请稍后刷新查看</p>
              )}
              {plansState === 'ready' && plans.length === 0 && (
                <p className="home-v2-addon-empty">暂无可用套餐</p>
              )}
              {plans.map((plan, i) => {
                const visual = PACKAGE_VISUALS[i];
                // free 档无 durationDays, 不作为可购买的订阅卡
                if (plan.durationDays <= 0) return null;
                return (
                  <article
                    key={plan.id}
                    className={`home-v2-package-card${visual?.recommended ? ' is-recommended' : ''}`}
                  >
                    {visual?.tag && <span className="home-v2-package-tag">{visual.tag}</span>}
                    <h3>{plan.name}</h3>
                    <div className="home-v2-package-price">
                      <span className="cur">￥</span>
                      <span className="num">{(plan.priceCents / 100).toFixed(2)}</span>
                    </div>
                    <p className="home-v2-package-credits">✦ {plan.monthlyCredits} 积分 / 月</p>
                    {/* 权益文案由后端 buildPerkLabels 生成 —— 改权益只需改一处,
                        不会出现「宣传页写的和实际给的不一样」 */}
                    <ul className="home-v2-package-list">
                      {plan.perkLabels.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    {/*
                     * 2026-10-21: 订阅购买已接入订单+支付链路。
                     * MembershipPlan 不在 Product 表里, 下单时走 `membershipPlanId`,
                     * 结算页 (`/checkout/membership?planId=`) 与积分包同一条支付通道。
                     */}
                    <button
                      type="button"
                      className="home-v2-package-buy"
                      onClick={() => navigate(`/checkout/membership?planId=${encodeURIComponent(plan.id)}`)}
                    >
                      立即订阅
                    </button>
                  </article>
                );
              })}
            </div>
          ) : pkgTab === 'addon' ? (
            <div className="home-v2-addon-row">
              {addonsState === 'loading' && (
                <p className="home-v2-addon-empty">积分包加载中…</p>
              )}
              {addonsState === 'error' && (
                <p className="home-v2-addon-empty">积分包暂时加载失败，请稍后刷新查看</p>
              )}
              {addonsState === 'ready' && addons.length === 0 && (
                <p className="home-v2-addon-empty">暂无可用积分包</p>
              )}
              {addons.map((p, i) => (
                <article key={p.id} className="home-v2-addon-card">
                  {ADDON_ICONS[i] && (
                    <img
                      src={`${A}/icons/${ADDON_ICONS[i]}.svg`}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <h3>{p.name}</h3>
                  <div className="home-v2-addon-price">
                    <span className="cur">￥</span>
                    <span className="num">{(p.priceCents / 100).toFixed(2)}</span>
                    {p.originalPriceCents && p.originalPriceCents > p.priceCents && (
                      <del>原价￥{(p.originalPriceCents / 100).toFixed(2)}</del>
                    )}
                  </div>
                  {/*可生成张数不再写死「积分 ÷ 10」—— 实际每次扣多少以能力消耗价为准,
                      与生成页显示的同一个数, 免得两处算法漂移 */}
                  <p>
                    {p.credits} 积分
                    {p.creditsValidDays > 0 ? ` · ${p.creditsValidDays} 天内有效` : ' · 永久有效'}
                  </p>
                  <button
                    type="button"
                    className="home-v2-package-buy"
                    onClick={() => navigate('/packages')}
                  >
                    立即购买
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
            <div className="home-v2-addon-row">
              {campaigns.map((c) =>
                c.type === 'limited_price' && c.product && typeof c.priceCents === 'number' ? (
                  <article key={c.id} className="home-v2-addon-card home-v2-campaign-card">
                    <span className="home-v2-campaign-tag">限时价</span>
                    <h3>{c.product.name}</h3>
                    <div className="home-v2-addon-price">
                      <span className="cur">￥</span>
                      <span className="num">{(c.priceCents / 100).toFixed(2)}</span>
                      <del>原价￥{(c.product.priceCents / 100).toFixed(2)}</del>
                    </div>
                    <p>
                      {c.name} · {formatCampaignEnd(c.endAt)}结束
                    </p>
                    <button
                      type="button"
                      className="home-v2-package-buy"
                      onClick={() => navigate(`/checkout/${encodeURIComponent(c.product!.sku)}`)}
                    >
                      立即抢购
                    </button>
                  </article>
                ) : (
                  <article key={c.id} className="home-v2-addon-card home-v2-campaign-card">
                    <span className="home-v2-campaign-tag">限时免费</span>
                    <h3>{c.name}</h3>
                    <div className="home-v2-addon-price">
                      <span className="num">0 积分</span>
                    </div>
                    <p>
                      {(c.capabilityIds ?? []).map((id) => capabilityName(id)).join(' / ')}
                      <br />
                      {formatCampaignEnd(c.endAt)}结束
                    </p>
                    <button
                      type="button"
                      className="home-v2-package-buy"
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

      {/* ── 5. 优秀案例 ── */}
      {activeCase && (
      <section className="home-v2-cases">
        <h2>优秀案例，了解工具能力</h2>
        <div className="home-v2-case-tabs" role="tablist">
          {caseTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={caseTab === t.key}
              className={caseTab === t.key ? 'is-active' : ''}
              onClick={() => setCaseTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="home-v2-case-grid">
          {activeCase.files.map((f) => (
            <button
              key={f}
              type="button"
              className="home-v2-case-card"
              onClick={() => navigate(caseTarget(activeCase.key))}
            >
              <img src={`${A}/case/${f}`} alt={activeCase.label} loading="lazy" />
              <span className="home-v2-case-cta">做同款</span>
            </button>
          ))}
        </div>
      </section>
      )}

      {/* ── 6. 产品特性 ── */}
      <section className="home-v2-features">
        <div className="home-v2-section-heading">
          <h2>为电商而生的 AI 作图神器</h2>
          <p>上传、下单、下载，全流程在同一个工作台完成</p>
        </div>
        <article className="home-v2-feature-wide">
          <div className="home-v2-feature-copy">
            <h3>一张商品图，搞定全套图</h3>
            <ul>
              <li>省下布景、拍摄、修图的重复成本</li>
              <li>一张图延展多套视觉，快速测试点击率</li>
              <li>风格统一，适合店铺、广告、详情页同步使用</li>
            </ul>
            <button type="button" className="home-v2-cta" onClick={() => navigate('/product-kit')}>
              去试试
            </button>
          </div>
          <div className="home-v2-feature-media">
            {/* 参考站该区是 banner 背景图内嵌, 本项目改用真实产出拼贴(诚实替代)。
                网格为 4 列 2 行: 主图跨 2x2 占 4 格, 余 4 格各放一张 → 共 5 张, 不留空行 */}
            <img className="home-v2-feature-main" src={`${A}/feat/top_01.png`} alt="" loading="lazy" />
            <img className="home-v2-feature-left" src={`${A}/feat/left_01.png`} alt="" loading="lazy" />
            <img className="home-v2-feature-right" src={`${A}/feat/right_02.png`} alt="" loading="lazy" />
            <img className="home-v2-feature-strip" src={`${A}/feat/top_02.png`} alt="" loading="lazy" />
            <img className="home-v2-feature-strip" src={`${A}/feat/top_03.png`} alt="" loading="lazy" />
          </div>
        </article>
        <div className="home-v2-feature-grid">
          <article className="home-v2-feature-card">
            <h3>一键生成完整的电商详情图组</h3>
            <ul>
              <li>把参数和卖点转成可视化内容</li>
              <li>模块化输出，方便直接排版落地</li>
              <li>提升页面完整度，减少设计制作时间</li>
            </ul>
            <button type="button" className="home-v2-cta" onClick={() => navigate('/product-detail')}>
              去试试
            </button>
          </article>
          <article className="home-v2-feature-card">
            <h3>复刻爆款图的设计风格</h3>
            <ul>
              <li>拆解爆款视觉逻辑，降低试错成本</li>
              <li>跟款上新更快，趋势不掉队</li>
              <li>保留原图氛围，替换主体不违和</li>
            </ul>
            <button type="button" className="home-v2-cta" onClick={() => navigate('/viral-clone')}>
              去试试
            </button>
          </article>
        </div>
      </section>

      {/* ── 7. 页脚 ── */}
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
