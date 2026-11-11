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
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../context/AdminContext';
import { useAuth } from '../context/AuthContext';
import { useCredits } from '../context/CreditsContext';
import { useAccountMembership } from './hooks';
import { Avatar, Dropdown } from '../ui';

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return '长期有效';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '待确认';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
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

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
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
        ? `${membership.monthlyCredits.toLocaleString('zh-CN')} 积分`
        : isMember
          ? '暂无月度赠送'
          : '未开通';
  const accountName = email?.split('@')[0] || '用户';

  return (
    <Dropdown
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottomRight"
      modal={false}
      classNames={{ root: 'app-user-dropdown' }}
      menu={{
        header: (
          <div className="app-user-menu-head">
            <div className="app-user-menu-identity">
              <Avatar size={42} className="app-user-menu-avatar">
                {(email ?? 'U').charAt(0).toUpperCase()}
              </Avatar>
              <div className="app-user-menu-user-copy">
                <strong>你好，{accountName}</strong>
                <span title={email ?? ''}>{email}</span>
              </div>
              <div className="app-user-menu-balance">
                <span>积分余额</span>
                <strong>{balance ? balance.balance.toLocaleString('zh-CN') : '—'}</strong>
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

              <button
                type="button"
                className="app-user-menu-package-action"
                onClick={() => go('/packages')}
              >
                {isMember ? '续费或升级套餐' : '选购套餐'}
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        ),
        items: [
          {
            key: 'account',
            icon: linkIcon(<Settings size={16} />),
            label: menuLabel('账户设置', '资料、安全与通知偏好'),
            onClick: () => go('/account'),
          },
          {
            key: 'works',
            icon: linkIcon(<Images size={16} />),
            label: menuLabel('我的作品', '查看全部创作结果'),
            onClick: () => go('/works'),
          },
          {
            key: 'orders',
            icon: linkIcon(<Receipt size={16} />),
            label: menuLabel('我的订单', '订单、支付与发票'),
            onClick: () => go('/orders'),
          },
          {
            key: 'credits',
            icon: linkIcon(<Wallet size={16} />),
            label: menuLabel('积分明细', '余额、充值与消费记录'),
            onClick: () => go('/credits'),
          },
          {
            key: 'tickets',
            icon: linkIcon(<LifeBuoy size={16} />),
            label: menuLabel('我的工单', '问题反馈与客服回复'),
            onClick: () => go('/tickets'),
          },
          ...(isAdminRole
            ? [
                { key: 'divider-admin', type: 'divider' as const },
                {
                  key: 'admin',
                  icon: linkIcon(<ShieldCheck size={16} />),
                  label: menuLabel('进入运营后台', '管理与运营工作台'),
                  onClick: () => go('/admin'),
                },
              ]
            : []),
          { key: 'divider-logout', type: 'divider' as const },
          {
            key: 'logout',
            danger: true,
            icon: linkIcon(<LogOut size={16} />),
            label: menuLabel('退出登录', '安全退出当前账户'),
            onClick: () => {
              setOpen(false);
              logout();
              navigate('/login');
            },
          },
        ],
      }}
    >
      <button
        className={`app-user${open ? ' is-open' : ''}`}
        type="button"
        aria-label="打开账户菜单"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar size={28} className="app-user-avatar">
          {(email ?? 'U').charAt(0).toUpperCase()}
        </Avatar>
        <span className="app-user-email" title={email ?? ''}>
          {email}
        </span>
        <ChevronDown size={14} className="app-user-chevron" aria-hidden="true" />
      </button>
    </Dropdown>
  );
}
