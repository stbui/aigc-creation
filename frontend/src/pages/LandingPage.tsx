import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { capabilityById, toolPath } from '../lib/capabilities';
import { useCapabilities } from '../hooks/useCapabilities';
import { PromoBar } from '../components/PromoBar';
import { useAuth } from '../context/AuthContext';

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
 * 品牌标识保留本项目自有 (电商视觉工坊), 不替换为参考站商标。
 */

/** 资源前缀: 全部落在 public/landing 下, 由 vite 原样拷贝 */
const A = '/landing';

interface BizCard {
  title: string;
  desc: string;
  img: string;
  icon: string;
  to: string;
}

const BIZ_CARDS: BizCard[] = [
  {
    title: '商品主图',
    desc: '一键生成白底、场景、卖点等主图套图',
    img: `${A}/biz/商品套图.png`,
    icon: 'm_spzt',
    to: '/product-kit',
  },
  {
    title: '商品详情',
    desc: '一键生成卖点、参数、细节等详情长图',
    img: `${A}/biz/商品详情.png`,
    icon: 'm_spxq',
    to: '/product-detail',
  },
  {
    title: '爆款复刻',
    desc: '一键复刻多张同款风格商品图',
    img: `${A}/biz/爆款复刻.png`,
    icon: 'm_bkfk',
    to: '/viral-clone',
  },
];

interface ToolEntry {
  label: string;
  icon: string;
  to: string;
}

const TOOL_ENTRIES: ToolEntry[] = [
  { label: '局部重绘', icon: 'm_jbch', to: '/local-redraw' },
  { label: '一键抠图', icon: 'm_bjxc', to: '/background-remove' },
  { label: '去除水印', icon: 'm_qcsy', to: '/watermark-remove' },
  { label: '产品精修', icon: 'm_cpjx', to: '/product-retouch' },
  { label: '图片翻译', icon: 'm_tpfy', to: '/image-translate' },
  { label: '智能扩图', icon: 'm_znkt', to: '/image-expand' },
  { label: '商品换色', icon: 'm_sphs', to: '/product-recolor' },
  { label: '旋转角度', icon: 'm_jdxz', to: '/rotate-angle' },
];

/** 订阅套餐: 参考站真实价目 (用户决策「完全照搬」) */
const PACKAGES = [
  {
    tag: '体验尝鲜',
    name: '周卡',
    price: '9.90',
    origin: '29.90',
    credits: '100 订阅积分',
    features: ['可生成10张图片', '送70次AI修图', '有效期7天'],
    extras: ['专享快速生成通道 2K/4K', '同时处理多个任务', '加油包会员专享95折'],
    recommended: false,
  },
  {
    tag: '月卡',
    name: '月卡',
    price: '39.90',
    origin: '139.90',
    credits: '260 订阅积分',
    features: ['可生成26张图片', '送320次AI修图', '有效期30天'],
    extras: ['专享快速生成通道 2K/4K', '同时处理多个任务', '加油包会员专享95折'],
    recommended: false,
  },
  {
    tag: '推荐',
    name: '季卡',
    price: '109.00',
    origin: '379.90',
    credits: '1100 订阅积分',
    features: ['可生成110张图片', '送850次AI修图', '有效期90天（每月发放）'],
    extras: ['专享快速生成通道 2K/4K', '同时处理多个任务', '加油包会员专享95折'],
    recommended: true,
  },
  {
    tag: '年卡',
    name: '年卡',
    price: '359.00',
    origin: '1249.90',
    credits: '4880 订阅积分',
    features: ['可生成488张图片', '送1900次AI修图', '有效期365天（每月发放）'],
    extras: ['专享快速生成通道 2K/4K', '同时处理多个任务', '加油包会员专享95折'],
    recommended: false,
  },
];

interface AddonPack {
  icon: string;
  name: string;
  price: string;
  origin: string;
  desc: string;
}

/** 加油包 tab 内容 */
const ADDON_PACKS: AddonPack[] = [
  { icon: 'icon_jcb', name: '基础加油包', price: '19.90', origin: '29.90', desc: '100 积分 · 可生成 10 张图片' },
  { icon: 'icon_bzb', name: '进阶加油包', price: '69.90', origin: '99.90', desc: '400 积分 · 可生成 40 张图片' },
  { icon: 'icon_zyb', name: '全站加油包', price: '129.90', origin: '199.90', desc: '800 积分 · 可生成 80 张图片' },
  { icon: 'icon_qjb', name: '全量加油包', price: '299.90', origin: '459.90', desc: '2000 积分 · 可生成 200 张图片' },
];

/** 案例 tab: key → 图片前缀与文件名列表 (实拍自参考站 case-tab 切换) */
const CASE_TABS = [
  { key: 'spzt', label: '商品主图', files: buildFiles('spzt', 16, 'png', 'jpg') },
  { key: 'spxqt', label: '商品详情图', files: buildFiles('spxqt', 16, 'png') },
  { key: 'bkfk', label: '爆款复刻', files: buildFiles('bkfk', 8, 'png', undefined, 0) },
  { key: 'cyst', label: '创意生图', files: buildFiles('cyst', 8, 'png', undefined, 0) },
  { key: 'cpjx', label: '产品精修', files: buildFiles('cpjx', 16, 'png') },
  { key: 'yjkt', label: '一键抠图', files: buildFiles('yjkt', 16, 'png') },
  { key: 'xzjd', label: '旋转角度', files: buildFiles('xzjd', 16, 'png') },
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
 *   右侧营销位为参考站的签到/新人礼包（本地无积分体系）→ 改为如实标注「本地算法 · 不限次数」
 */
function LandingHeader() {
  const { data } = useCapabilities();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);

  // 落地页工具区只展示「电商生图 / AI修图」两组, 与 AppLayout 顶导口径一致
  // (参考站这两处都只有两个下拉)。写死 id 而非 slice 是因为落地页要显式排除
  // ai_video —— 它是倒序第三组, slice 会随registry 调序而误纳。
  const navGroups = useMemo(
    () => (data?.groups ?? []).filter((g) => g.id === 'ecommerce_gen' || g.id === 'ai_retouch'),
    [data],
  );

  return (
    <>
      <PromoBar />
      <header className="landing-topbar">
        <Link to="/" className="landing-brand">
          <span className="landing-brand-mark">EV</span>
          <span className="landing-brand-text">电商视觉工坊</span>
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
                  {(data?.items ?? [])
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
          <span className="landing-quota-pill">本地算法 · 不限次数</span>
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
      </header>
    </>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const [pkgTab, setPkgTab] = useState<'sub' | 'addon'>('sub');
  const [caseTab, setCaseTab] = useState<string>(CASE_TABS[0].key);

  const activeCase = useMemo(
    () => CASE_TABS.find((t) => t.key === caseTab) ?? CASE_TABS[0],
    [caseTab],
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
    return def ? `/tools/${def.id}` : '/workbench';
  };

  return (
    <div className="landing-page">
      <LandingHeader />

      {/* ── 1. hero ── */}
      <section className="home-v2-hero">
        <h1>极画AI电商图 上新快10倍 拍图成本直降90%</h1>
        <p>上传商品图，一键生成白底图、场景图、卖点图、详情页全套电商图</p>
      </section>

      {/* ── 2. 业务场景 ── */}
      <section className="home-v2-businesses">
        <div className="home-v2-business-grid">
          {BIZ_CARDS.map((b) => (
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
          {TOOL_ENTRIES.map((t) => (
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
          <button type="button" role="tab" aria-selected={false} className="is-soon" disabled title="暂未开放">
            双节上新
          </button>
        </div>
        <div className="home-v2-package-scroller">
          {pkgTab === 'sub' ? (
            <div className="home-v2-package-row">
              {PACKAGES.map((p) => (
                <article
                  key={p.name}
                  className={`home-v2-package-card${p.recommended ? ' is-recommended' : ''}`}
                >
                  {p.tag && <span className="home-v2-package-tag">{p.tag}</span>}
                  <h3>{p.name}</h3>
                  <div className="home-v2-package-price">
                    <span className="cur">￥</span>
                    <span className="num">{p.price}</span>
                    <del>原价￥{p.origin}</del>
                  </div>
                  <p className="home-v2-package-credits">✦ {p.credits}</p>
                  <ul className="home-v2-package-list">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <ul className="home-v2-package-extras">
                    {p.extras.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button type="button" className="home-v2-package-buy">
                    立即购买
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="home-v2-addon-row">
              {ADDON_PACKS.map((p) => (
                <article key={p.name} className="home-v2-addon-card">
                  <img src={`${A}/icons/${p.icon}.svg`} alt="" aria-hidden loading="lazy" decoding="async" />
                  <h3>{p.name}</h3>
                  <div className="home-v2-addon-price">
                    <span className="cur">￥</span>
                    <span className="num">{p.price}</span>
                    <del>原价￥{p.origin}</del>
                  </div>
                  <p>{p.desc}</p>
                  <button type="button" className="home-v2-package-buy">
                    立即购买
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── 5. 优秀案例 ── */}
      <section className="home-v2-cases">
        <h2>优秀案例，了解工具能力</h2>
        <div className="home-v2-case-tabs" role="tablist">
          {CASE_TABS.map((t) => (
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
            <strong>电商视觉工坊 · AI 电商图</strong>
            <p>让每一张商品图，都更快抵达高转化。</p>
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
            <span>积分购买</span>
            <span>积分明细</span>
            <Link to="/works">任务记录</Link>
          </div>
          <div className="landing-footer-col">
            <h4>支持与服务</h4>
            <span>帮助中心</span>
            <span>用户协议</span>
            <span>隐私政策</span>
          </div>
        </div>
        <p className="landing-footer-copy">
          © 2026 电商视觉工坊. 本地演示项目 · 商业内容与案例素材按参考站设计复刻，仅用于设计对齐演示。
        </p>
      </footer>
    </div>
  );
}
