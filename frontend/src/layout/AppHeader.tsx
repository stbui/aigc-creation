import { useMemo, useState } from 'react';
import { Button, Dropdown } from '../ui';
import { ChevronDown, Menu, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { CapabilityDef, CapabilityGroup } from '../types/api';
import { MODE_LABELS } from '../lib/constants';
import { isCapabilityVisible, toolPath } from '../lib/capabilities';
import { useAuth } from '../context/AuthContext';
import { useCredits } from '../context/CreditsContext';
import { useHeaderElevated } from './hooks';
import { CapabilityIcon } from './SideRail';
import { NotificationBell } from './NotificationBell';
import { UserAccountMenu } from './UserAccountMenu';

interface Props {
  groups: CapabilityGroup[];
  items: CapabilityDef[];
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
}

/**
 * 顶部导航。
 *
 * 品牌区、能力分组下拉、余额与账户动作区；≤900px 只留品牌、账户与汉堡按钮，
 * 汉堡按钮唤起 `AppSidebar` 的移动抽屉。滚动阴影由 `useHeaderElevated` 托管。
 */
export function AppHeader({ groups, items, mobileNavOpen, onOpenMobileNav }: Props) {
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { balance } = useCredits();
  const [navOpen, setNavOpen] = useState<string | null>(null);
  const headerElevated = useHeaderElevated();

  // 下架/规划中的能力不进顶导；分组随之收敛，避免出现空下拉。
  const visibleItems = useMemo(() => items.filter(isCapabilityVisible), [items]);
  const topGroups = useMemo(
    () => groups.filter((g) => visibleItems.some((c) => c.group === g.id)),
    [groups, visibleItems],
  );

  return (
    <header className={`app-header${headerElevated ? ' is-scrolled' : ''}`}>
      <Link to="/workbench" className="app-brand">
        <span className="app-brand-mark">
          <img src="/brand/huojue-mark.svg" alt="货觉AI" className="app-brand-mark-img" />
        </span>
        <span className="app-brand-text">货觉</span>
        <span className="app-brand-ai">AI</span>
      </Link>

      <nav className="app-topnav">
        <Link to="/" className="app-topnav-item">
          首页
        </Link>
        {topGroups.map((g) => (
          <Dropdown
            key={g.id}
            open={navOpen === g.id}
            onOpenChange={(v) => setNavOpen(v ? g.id : null)}
            classNames={{ root: 'app-topnav-dropdown' }}
            menu={{
              items: visibleItems
                .filter((c) => c.group === g.id)
                .map((c) => ({
                  key: c.id,
                  label: (
                    <span className="app-topnav-item-row">
                      <CapabilityIcon id={c.id} size={20} />
                      {c.name}
                      {c.mode === 'planned' && <span className="app-mode-tag">{MODE_LABELS.planned}</span>}
                    </span>
                  ),
                  disabled: c.mode === 'planned',
                  onClick: () => navigate(toolPath(c.id)),
                })),
            }}
            placement="bottomLeft"
          >
            <Button type="text" className="app-topnav-item" icon={<ChevronDown size={14} />}>
              {g.name}
            </Button>
          </Dropdown>
        ))}
        <Link to="/works" className="app-topnav-item">
          我的作品
        </Link>
        <Link to="/packages" className="app-topnav-item">
          购买套餐
        </Link>
        <Link to="/invitations" className="app-topnav-item">
          邀请有奖
        </Link>
        <Link to="/tickets?type=consultation&compose=1" className="app-topnav-item">
          联系客服
        </Link>
        {/* 数据中心只在侧栏，顶导不重复入口 */}
      </nav>

      <div className="app-header-right">
        {/* 顶导余额：未登录不显示，避免展示假的 0 */}
        {/* 消息铃铛: 未登录时组件自身返回 null */}
        <NotificationBell />
        {token && (
          <Link
            to="/credits"
            className="app-quota"
            title="查看积分明细"
            aria-label={balance ? `积分余额 ${balance.balance}，查看积分明细` : '查看积分明细'}
          >
            <Wallet size={14} aria-hidden="true" />
            <span className="app-quota-num">
              {balance ? balance.balance.toLocaleString('zh-CN') : '—'}
            </span>
            <span className="app-quota-label">积分</span>
          </Link>
        )}
        {token && <span className="app-header-divider" aria-hidden="true" />}
        {token ? (
          <UserAccountMenu />
        ) : (
          /* 未登录：唤起登录弹窗 */
          <button type="button" className="app-header-action app-guest-login" onClick={openLogin}>
            登录/注册
          </button>
        )}
        <button
          type="button"
          className="app-mobile-toggle"
          aria-label="打开导航菜单"
          aria-expanded={mobileNavOpen}
          onClick={onOpenMobileNav}
        >
          <Menu size={20} />
        </button>
      </div>
    </header>
  );
}
