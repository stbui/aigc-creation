import {
  Activity,
  Bell,
  Power,
  BadgeCheck,
  BellRing,
  CalendarClock,
  ChevronDown,
  Coins,
  CreditCard,
  DatabaseBackup,
  FileSpreadsheet,
  FileText,
  Gift,
  HardDrive,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  Package,
  Receipt,
  Scale,
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar, Button, Drawer, Dropdown, Input, Layout, Modal, Tooltip } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { adminSearchApi } from '../../lib/api';
import { hasUnsavedChanges } from '../../lib/unsaved-guard';
import type { AdminSearchGroup } from '../../types/api';
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
      // 工单紧跟任务监控: 两者都是「今天有什么要处理」的队列,
      // 客服先看失败任务再回对应工单, 动线是连着的
      { path: '/admin/tickets', label: '工单处理', icon: MessagesSquare, permission: 'ticket.read' },
    ],
  },
  {
    // 内容组: 法务文本与站内消息都是「发给全体用户的话」, 改动影响面覆盖全部账号,
    // 因此与日常运营操作分开放 (误改一条协议比调错一次价格更难挽回)。
    name: '内容',
    items: [
      { path: '/admin/legal', label: '法务文档', icon: Scale, permission: 'legal.read' },
      { path: '/admin/notifications', label: '站内消息', icon: BellRing, permission: 'message.write' },
      // AI 标识与法务同组: 都是「发给全体用户的话」, 且改动会烙印到每一张产出图
      { path: '/admin/aigc-label', label: 'AI 标识', icon: BadgeCheck, permission: 'setting.read' },
    ],
  },
  {
    name: '交易',
    items: [
      // 顺序即运营的日常动线: 先看卖什么(商品)、再看卖出去什么(订单)、
      // 再对账(积分账本)、最后调价与促销。
      { path: '/admin/products', label: '商品管理', icon: Package, permission: 'product.read' },
      { path: '/admin/orders', label: '订单管理', icon: Receipt, permission: 'order.read' },
      { path: '/admin/credits', label: '积分账本', icon: Coins, permission: 'credit.read' },
      { path: '/admin/credit-prices', label: '能力消耗价', icon: Coins, permission: 'product.price' },
      { path: '/admin/coupons', label: '优惠券', icon: TicketPercent, permission: 'marketing.write' },
      { path: '/admin/campaigns', label: '限时活动', icon: Megaphone, permission: 'marketing.write' },
      { path: '/admin/marketing-rules', label: '邀请与签到', icon: Gift, permission: 'marketing.write' },
    ],
  },
  {
    // 财务组独立于「交易」: 发票与对账是**钱已收进来之后**的动作 (开票、核对),
    // 与「卖什么/卖了多少」的运营动线不是同一批人, 混排会让财务每次多扫 7 项。
    name: '财务',
    items: [
      // 支付渠道放最前: 它是「钱从哪条路进来」的前置事实, 排障时先看这里
      // 再去看订单/对账。只读页 —— 凭据与通道切换都走部署环境变量。
      {
        path: '/admin/payment-channels',
        label: '支付渠道',
        icon: CreditCard,
        permission: 'payment.read',
      },
      { path: '/admin/invoices', label: '发票管理', icon: FileText, permission: 'invoice.write' },
      {
        path: '/admin/reconciliation',
        label: '渠道对账',
        icon: FileSpreadsheet,
        permission: 'payment.read',
      },
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
      // 能力管控与模型配置分开: 前者是"这项能力能不能卖", 后者是"走哪条通道"。
      // 通道全挂时运营要能一键停单项, 不必先理解线路配置。
      { path: '/admin/capabilities', label: '能力管控', icon: Power, permission: 'capability.read' },
    ],
  },
  {
    name: '数据安全',
    items: [
      { path: '/admin/backups', label: '数据备份', icon: DatabaseBackup, permission: 'backup.read' },
      { path: '/admin/retention', label: '保留期清理', icon: Timer, permission: 'backup.read' },
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

/**
 * 顶栏全局搜索 (B7)。
 *
 * 交互规则的三处取舍:
 *   1. **少于 2 个字符不发请求**。后端同样会返回空组 —— 两边一致,
 *      是为了让「打字过程中不闪错误」这件事不依赖某一边的实现。
 *   2. **每类只显示前 5 条 + 该类总数**。顶栏的用途是「跳过去」,
 *      翻页留给各列表页(那里本来就有完整筛选)。
 *   3. **点击即跳转并清空关键词**。继续保留关键词会让下一次打开面板
 *      看到上次的结果, 分不清是缓存还是新搜索。
 */
function GlobalSearch({ canSearch, onNavigate }: { canSearch: boolean; onNavigate: (to: string) => void }) {
  const [keyword, setKeyword] = useState('');
  const [groups, setGroups] = useState<AdminSearchGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const q = keyword.trim();

  useEffect(() => {
    if (!canSearch || q.length < 2) {
      setGroups([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // 300ms 防抖: 逐字符发请求在 SQLite 上就是每敲一个字五次全表 LIKE
    const timer = window.setTimeout(() => {
      adminSearchApi
        .search(q, controller.signal)
        .then((r) => {
          setGroups(r.groups);
          setError(null);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : '搜索失败');
          setGroups([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, canSearch]);

  // 点击面板外关闭: 用 pointerdown 而不是 Input 的 onBlur ——
  // onBlur 会先于点击触发, 面板在点击生效前就消失, 结果永远点不中
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const go = (to: string) => {
    onNavigate(to);
    setKeyword('');
    setGroups([]);
    setOpen(false);
  };

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  /*
   * 面板从「1 个字符」起就要打开。
   *
   * 之前 `panelOpen = open && q.length >= 2`: 输入第一个字时既不请求也不开面板,
   * 屏幕上**什么都不发生**, 用户以为搜索坏了就放弃了。现在先给规则提示,
   * 到 2 个字符再真正搜索。
   */
  const panelOpen = open && q.length >= 1;

  return (
    <div className="adm-search-wrap" ref={wrapRef}>
      <Input
        className="adm-search"
        prefix={<Search size={15} />}
        placeholder={canSearch ? '搜索用户 / 订单 / 工单 / 任务 / 素材' : '无搜索权限'}
        allowClear
        disabled={!canSearch}
        value={keyword}
        onChange={(e) => {
          setKeyword(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onPressEnter={() => {
          const first = groups.flatMap((g) => g.items)[0];
          if (first) go(first.link);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />

      {panelOpen && (
        <div className="adm-search-panel">
          {q.length < 2 ? (
            <div className="adm-search-hint">至少输入 2 个字符开始搜索</div>
          ) : loading && groups.length === 0 ? (
            <div className="adm-search-hint">搜索中…</div>
          ) : error ? (
            <div className="adm-search-hint is-error">{error}</div>
          ) : total === 0 ? (
            <div className="adm-search-hint">没有匹配结果</div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="adm-search-group">
                <div className="adm-search-group-title">
                  {g.label}
                  <span>{g.total}</span>
                </div>
                {g.items.map((hit) => (
                  <button
                    key={`${g.key}-${hit.id}`}
                    type="button"
                    className="adm-search-item"
                    onClick={() => go(hit.link)}
                  >
                    <span className="adm-search-item-title">{hit.title}</span>
                    <span className="adm-search-item-sub">{hit.subtitle}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AdminLayout({ children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdmin();
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** 窄屏 (≤900px) 时侧栏不再是一列图标, 改为抽屉导航 */
  const [isNarrow, setIsNarrow] = useState(false);
  /** 有未保存变更时, 待跳转的目标路径; 非 null 即弹确认框 */
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  // 窄屏自动折叠: 后台最小使用宽度 1280, 更窄时侧栏收为图标栏
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  /*
   * 窄屏下侧栏变成"只有一列图标、不能展开"的半残状态: 之前的折叠按钮只管 collapsed,
   * 而抽屉的 open 状态全仓没有任何地方置 true。手机上因此**没有任何导航入口**。
   * 这里在 ≤900px 时把折叠按钮改为打开抽屉。
   */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsNarrow(mq.matches);
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
    if (hasUnsavedChanges()) {
      setLeaveTo(to);
      return;
    }
    navigate(to);
    setMobileNavOpen(false);
  };

  /*
   * 站内链接统一拦截。侧栏按钮走 `go`, 页面内的 <Link>/<a> 走这里 ——
   * 编辑页有未保存变更时先确认再放行, 避免"点一下导航, 半天的修改没了"。
   * 站外链接、锚点、带修饰键的点击 (新标签打开) 一律不拦。
   */
  const onClickCapture = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    const href = anchor?.getAttribute('href') ?? '';
    if (!href.startsWith('/')) return;
    const here = `${window.location.pathname}${window.location.search}`;
    if (href === here) return;
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    setLeaveTo(href);
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
    <Layout className="adm-layout" onClickCapture={onClickCapture}>
      <Layout.Header className="adm-header">
        <div className="adm-header-left">
          <button
            type="button"
            className="adm-collapse-btn"
            onClick={() => (isNarrow ? setMobileNavOpen(true) : setCollapsed((c) => !c))}
            aria-label={isNarrow ? '打开导航菜单' : collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <Menu size={18} />
          </button>
          <Link to="/admin" className="adm-brand">
            货觉<span>运营后台</span>
          </Link>
          <EnvironmentBadge />
        </div>

        <div className="adm-header-right">
          <GlobalSearch canSearch={can('data.search')} onNavigate={navigate} />
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

      {/* 未保存变更的离开确认: 用 antd Modal, Esc 可关、焦点被限制在框内 */}
      <Modal
        open={leaveTo !== null}
        title="有未保存的变更"
        okText="放弃变更并离开"
        cancelText="留下继续编辑"
        okButtonProps={{ danger: true }}
        onOk={() => {
          const to = leaveTo;
          setLeaveTo(null);
          if (to) navigate(to);
        }}
        onCancel={() => setLeaveTo(null)}
      >
        当前页面有修改还没保存，离开后这些修改会丢失。
      </Modal>
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