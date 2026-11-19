import './UserAccountMenu.css';
import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Coins,
  Gem,
  Images,
  LifeBuoy,
  LogOut,
  Receipt,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdmin } from '../context/AdminContext';
import { useAuth } from '../context/AuthContext';
import { useCredits } from '../context/CreditsContext';
import { useAccountMembership } from './hooks';
import { formatLongDate, formatNumber } from '../lib/format';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui';

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return '长期有效';
  return formatLongDate(iso, '待确认');
}

function menuLabel(title: string, hint: string): ReactNode {
  return (
    <span className="app-user-menu-link-copy">
      <strong>{title}</strong>
      <small>{hint}</small>
    </span>
  );
}

function linkIcon(children: ReactNode): ReactNode {
  return <span className="app-user-menu-link-icon">{children}</span>;
}

export function UserAccountMenu() {
  const navigate = useNavigate();
  const { email, logout } = useAuth();
  const { balance } = useCredits();
  const { me, loading: adminLoading } = useAdmin();
  const [open, setOpen] = useState(false);
  const {
    membership,
    loading: membershipLoading,
    failed: membershipFailed,
    reload: reloadMembership,
  } = useAccountMembership();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void reloadMembership();
  };

  const isAdminRole = !adminLoading && me !== null;
  const isMember = membership?.isMember === true;
  const planName = membershipLoading && !membership
    ? '正在获取套餐'
    : membershipFailed && !membership
      ? '套餐信息暂不可用'
      : membership?.planName || '普通用户';
  const planState = membershipLoading && !membership
    ? '加载中'
    : membershipFailed && !membership
      ? '暂未获取'
      : isMember
        ? '生效中'
        : '未开通';
  const expiry = membershipLoading && !membership
    ? '正在获取'
    : membershipFailed && !membership
      ? '暂未获取'
      : isMember
        ? formatExpiry(membership?.expiresAt)
        : '尚未开通';
  const monthlyCredits = membershipLoading && !membership
    ? '正在获取'
    : membershipFailed && !membership
      ? '暂未获取'
      : isMember && membership?.monthlyCredits
        ? `${formatNumber(membership.monthlyCredits)} 积分`
        : isMember
          ? '暂无月度赠送'
          : '未开通';
  const accountName = email?.split('@')[0] || '用户';

  return (
    <DropdownMenu
      open={open}
      onOpenChange={handleOpenChange}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={`app-header-action app-user${open ? ' is-open' : ''}`}
          type="button"
          aria-label="打开账户菜单"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar className="app-user-avatar size-7">
            <AvatarFallback className="app-user-avatar">
              {(email ?? 'U').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="app-user-email" title={email ?? ''}>
            {email}
          </span>
          <ChevronDown size={14} className="app-user-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="app-user-dropdown ui-dropdown-content">
        <DropdownMenuGroup>
          <div className="app-user-menu-head">
            <div className="app-user-menu-identity">
              <Avatar className="app-user-menu-avatar size-[42px]">
                <AvatarFallback className="app-user-menu-avatar">
                  {(email ?? 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="app-user-menu-user-copy">
                <strong>你好，{accountName}</strong>
                <span title={email ?? ''}>{email}</span>
              </div>
              <div className="app-user-menu-balance">
                <span>积分余额</span>
                <strong>{formatNumber(balance?.balance)}</strong>
              </div>
            </div>

            <div className="app-user-menu-package">
              <div className="app-user-menu-package-main">
                <span className="app-user-menu-package-icon">
                  <Gem size={17} aria-hidden="true" />
                </span>
                <div className="app-user-menu-package-copy">
                  <span>当前套餐</span>
                  <strong>{planName}</strong>
                </div>
                <span className={`app-user-menu-plan-state${isMember ? ' is-active' : ''}`}>
                  {planState}
                </span>
              </div>

              <div className="app-user-menu-package-meta">
                <span>
                  <CalendarDays size={14} aria-hidden="true" />
                  到期日期
                  <strong>{expiry}</strong>
                </span>
                <span>
                  <Coins size={14} aria-hidden="true" />
                  每月赠送
                  <strong>{monthlyCredits}</strong>
                </span>
              </div>

              {isMember && membership?.cancelAtPeriodEnd && (
                <p className="app-user-menu-package-note">已取消自动续费，当前权益可使用至到期日</p>
              )}

              <Link className="app-user-menu-package-action" to="/packages">
                {isMember ? '续费或升级套餐' : '选购套餐'}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <DropdownMenuItem asChild>
            <Link to="/account">
              {linkIcon(<Settings size={16} />)}
              {menuLabel('账户设置', '资料、安全与通知偏好')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/works">
              {linkIcon(<Images size={16} />)}
              {menuLabel('我的作品', '查看全部创作结果')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/orders">
              {linkIcon(<Receipt size={16} />)}
              {menuLabel('我的订单', '订单、支付与发票')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/credits">
              {linkIcon(<Wallet size={16} />)}
              {menuLabel('积分明细', '余额、充值与消费记录')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/tickets">
              {linkIcon(<LifeBuoy size={16} />)}
              {menuLabel('我的工单', '问题反馈与客服回复')}
            </Link>
          </DropdownMenuItem>
          {isAdminRole && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/admin">
                  {linkIcon(<ShieldCheck size={16} />)}
                  {menuLabel('进入运营后台', '管理与运营工作台')}
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              logout();
              navigate('/login');
            }}
          >
            {linkIcon(<LogOut size={16} />)}
            {menuLabel('退出登录', '安全退出当前账户')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
