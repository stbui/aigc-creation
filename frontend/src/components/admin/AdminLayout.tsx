import {
  Activity,
  Bell,
  CalendarClock,
  ChevronDown,
  Coins,
  DatabaseBackup,
  Gift,
  HardDrive,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Receipt,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  TicketPercent,
  Timer,
  User,
  Users,
  Waypoints,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar, Button, Drawer, Dropdown, Input, Layout, Tooltip } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { APP_ENV, IS_PROD } from '../../lib/constants';

/**
 * 后台侧栏菜单定义。
 *
 * permission 为 null 表示该页面只要求后台身份, 无需权限点 (如概览的骨架入口)。
 * **无权项不渲染** —— 禁用会让用户困惑"为什么在这里又点不动"。
 */
interface MenuItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: string | null;
  /** 尚未实现的模块: 置灰但可见, 明确告知规划状态而非直接隐藏 */
  planned?: boolean;
}

interface MenuGroup {
  name: string;
  items: MenuItem[];
}

const MENU: MenuGroup[] = [
  {
    name: '总览',
    items: [
      {
        path: '/admin',
        label: '平台概览',
        icon: LayoutDashboard,
        permission: 'platform.dashboard',
      },
    ],
  },
  {
    name: '运营',
    items: [
      { path: '/admin/users', label: '用户管理', icon: Users, permission: 'user.read' },
      { path: '/admin/assets', label: '素材管理', icon: FolderOpen, permission: 'asset.read' },
      { path: '/admin/tasks', label: '任务监控', icon: Activity, permission: 'task.read' },
    ],
  },
  {
    name: '交易',
    items: [
      { path: '/admin/coupons', label: '优惠券', icon: TicketPercent, permission: 'marketing.write' },
      { path: '/admin/campaigns', label: '限时活动', icon: Megaphone, permission: 'marketing.write' },
      { path: '/admin/marketing-rules', label: '邀请与签到', icon: Gift, permission: 'marketing.write' },
      { path: '/admin/products', label: '商品管理', icon: Package, permission: 'product.read', planned: true },
      { path: '/admin/orders', label: '订单管理', icon: Receipt, permission: 'order.read', planned: true },
      { path: '/admin/credit-prices', label: '能力消耗价', icon: Coins, permission: 'product.price' },
      { path: '/admin/credits', label: '积分账本', icon: Coins, permission: 'credit.read', planned: true },
    ],
  },
  {
    name: '系统',
    items: [
      { path: '/admin/roles', label: '角色权限', icon: KeyRound, permission: 'audit.read' },
      { path: '/admin/settings', label: '系统设置', icon: Settings, permission: 'setting.read' },
      { path: '/admin/storage', label: '存储配置', icon: HardDrive, permission: 'setting.read' },
      { path: '/admin/scheduler', label: '定时任务', icon: CalendarClock, permission: 'setting.read' },
      { path: '/admin/audit-logs', label: '操作审计', icon: ScrollText, permission: 'audit.read' },
    ],
  },
  {
    // 模型组独立于「系统」: 这两项是生成链路的生产关键配置,
    // 排障时需要与通用系统设置分开看 (混在一起会淹没在长列表里)。
    name: '模型',
    items: [
      // 读/写权限分离: 运营可读可排障, 改配置仅管理员
      { path: '/admin/model-config', label: '模型配置', icon: SlidersHorizontal, permission: 'model.config_read' },
      { path: '/admin/model-calls', label: '调用记录', icon: Waypoints, permission: 'model.call_read' },
    ],
  },
  {
    name: '数据安全',
    items: [
      { path: '/admin/backups', label: '数据备份', icon: DatabaseBackup, permission: 'backup.read' },
      { path: '/admin/retention', label: '保留期清理', icon: Timer, permission: 'backup.read', planned: true },
    ],
  },
];

/**
 * 非生产环境才显示的环境标识, 防止误在生产执行测试操作。
 *
 * 文案来自各档位 env 文件的 VITE_ENV_LABEL（构建时注入），
 * 回落规则与 APP_ENV 对齐：development→开发 / test→测试 / 其他非生产→预发。
 * 显式给 label 的好处是「测试」与「预发」在界面上不会混为一谈 ——
 * 测试环境可以随便造脏数据，预发环境的数据往往要给客户看。
 */
function EnvironmentBadge() {
  if (IS_PROD) return null;
  const fallback = APP_ENV === 'development' ? '开发' : APP_ENV === 'test' ? '测试' : '预发';
  const label = import.meta.env.VITE_ENV_LABEL || fallback;
  return (
    <span className="adm-env-tag" title={`当前环境: ${APP_ENV} (${label})`}>
      {label}
    </span>
  );
}

interface Props {
  children: ReactNode;
}

/**
 * 按路径查侧栏菜单项 (2026-10-20 新增)。
 *
 * 供 AdminDashboardPage 的 NotImplementedPage 判定「这条 catch-all 命中的是
 * planned 待建模块, 还是纯打错的 URL」—— 两种情况的正确文案完全不同。
 * 复用 MENU 这一个数据源, 不另建路径表, 否则菜单改名就会与异常页文案脱节。
 */
export function findAdminMenuItem(path: string): MenuItem | undefined {
  return MENU.flatMap((g) => g.items).find((m) => m.path === path);
}

export function AdminLayout({ children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdmin();
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // 窄屏自动折叠: 后台最小使用宽度 1280, 更窄时侧栏收为图标栏
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // 按权限过滤: 无权项不渲染
  const groups = useMemo(
    () =>
      MENU.map((g) => ({
        ...g,
        items: g.items.filter((it) => it.permission === null || can(it.permission)),
      })).filter((g) => g.items.length > 0),
    [can],
  );

  // 精确匹配, 不做前缀匹配 —— 否则 /admin/users 会同时激活「平台概览」(/admin)
  const activePath = location.pathname.replace(/\/$/, '') || '/admin';

  // 待建模块也允许点击: 跳到占位页给出明确反馈, 而不是点了没反应
  // (完全禁用会让用户以为页面坏了, 也不如明确告知「尚未开放」)
  const go = (to: string) => {
    navigate(to);
    setMobileNavOpen(false);
  };

  const navList = (
    <nav className="adm-sider-nav">
      {groups.map((g) => (
        <div key={g.name} className="adm-sider-group">
          <div className="adm-sider-group-title">{collapsed ? '' : g.name}</div>
          {g.items.map((it) => {
            const Icon = it.icon;
            const isActive = activePath === it.path;
            const btn = (
              <button
                key={it.path}
                type="button"
                className={`adm-sider-item${isActive ? ' is-active' : ''}${it.planned ? ' is-planned' : ''}`}
                onClick={() => go(it.path)}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? it.label + (it.planned ? ' (待开放)' : '') : undefined}
              >
                <Icon size={18} className="adm-sider-item-icon" />
                {!collapsed && <span className="adm-sider-item-label">{it.label}</span>}
                {!collapsed && it.planned && <span className="adm-sider-item-tag">待建</span>}
              </button>
            );
            return collapsed ? (
              <Tooltip key={it.path} title={it.label} placement="right">
                {btn}
              </Tooltip>
            ) : (
              btn
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <Layout className="adm-layout">
      <Layout.Header className="adm-header">
        <div className="adm-header-left">
          <button
            type="button"
            className="adm-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <Menu size={18} />
          </button>
          <Link to="/admin" className="adm-brand">
            货觉<span>运营后台</span>
          </Link>
          <EnvironmentBadge />
        </div>

        <div className="adm-header-right">
          <Input
            className="adm-search"
            prefix={<Search size={15} />}
            placeholder="搜索用户 / 订单 / 素材"
            allowClear
            disabled
            title="全局搜索将在后续批次开放"
          />
          <Tooltip title="告警将在告警模块落地后开放">
            <button type="button" className="adm-icon-btn" aria-label="告警" disabled>
              <Bell size={17} />
            </button>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                { key: 'email', label: me?.email ?? '', icon: <User size={14} />, disabled: true },
                { type: 'divider' as const },
                {
                  key: 'frontend',
                  label: '返回前台',
                  onClick: () => navigate('/workbench'),
                },
                {
                  key: 'logout',
                  label: '退出登录',
                  icon: <LogOut size={14} />,
                  onClick: () => {
                    logout();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            <button type="button" className="adm-user">
              <Avatar size={26} className="adm-user-avatar">
                {(me?.email ?? 'A').charAt(0).toUpperCase()}
              </Avatar>
              <span className="adm-user-name">{me?.roleLabel ?? '加载中'}</span>
              <ChevronDown size={14} />
            </button>
          </Dropdown>
        </div>
      </Layout.Header>

      <Layout className="adm-body">
        <div className={`adm-sider${collapsed ? ' is-collapsed' : ''}`}>{navList}</div>

        <Drawer
          title="导航菜单"
          placement="left"
          width={280}
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          className="adm-mobile-drawer"
          extra={
            <Button type="text" icon={<X size={16} />} onClick={() => setMobileNavOpen(false)} />
          }
        >
          <div className="adm-sider is-mobile">{navList}</div>
        </Drawer>

        <Layout.Content className="adm-content">{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}

/**
 * 概览加载态: 保持布局稳定, 避免内容跳动。
 *
 * 2026-10-20: 与 `AdminWidgets.tsx` 的 `AdminListLoading` 是同一个东西
 * (同 class 同结构), 此处是第二份实现。现改为转出, 避免两处各改各的。
 */
export { AdminListLoading as AdminPageLoading } from './AdminWidgets';