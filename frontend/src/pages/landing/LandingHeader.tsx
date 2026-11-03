import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  CreditCard,
  Gift,
  Home,
  Images,
  LayoutDashboard,
  LogIn,
  Menu,
  MessageCircle,
} from 'lucide-react';

import { PromoBar } from './components';
import { NAV_ICONS } from './constants';
import { useAuth, useCapabilities } from './hooks';
import { isCapabilityVisible, toolPath } from './utils';

/**
 * 营销首页顶部导航 —— 复刻参考站 `.landing-topbar`（实拍 2026-10-17）:
 *   容器 1274x64 白底, padding `0 24px`, 相对定位 z10, grid + align-items center
 *   品牌 266x38 @24: logo 36x36 + 名称 16px #171A2B (padding `1px 6px`)
 *   左侧导航项 h32 / 13px / radius 8 / padding `0 14px`;
 *     首页为激活态 (54x32, #5546D8 + bg #F1EFFF), 其余 #667085 透明底
 *   下拉项 119x36 / 13px #475467 / radius 9 / padding `0 12px`
 *   右侧营销位为参考站的签到/新人礼包 → 改为如实标注「AI 创作 · 按能力计费」
 */
export function LandingHeader() {
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
