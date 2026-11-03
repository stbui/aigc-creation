import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ChevronDown,
  LogOut,
} from 'lucide-react';

import { cn } from '../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import {
  ADMIN_MENU,
  findAdminMenuGroup,
} from '../../components/admin/adminNav';
import type { AdminMenuItem } from '../../components/admin/adminNav';
import { hasUnsavedChanges } from '../../lib/unsaved-guard';
import { APP_ENV, IS_PROD } from '../../lib/constants';
import { useConfirm } from '../providers/ConfirmProvider';
import { AdminAlertBell } from '../../components/admin/AlertBell';
import { GlobalSearch } from './GlobalSearch';

const SIDEBAR_GROUPS_KEY = 'huojue.admin.sidebar-groups';

/**
 * 后台外壳。
 *
 * ## 结构
 *
 * 经典「上左右」：顶栏 56px（品牌 + 环境标识 + 账号）+ 侧栏 232 / 折叠 60 +
 * 内容区。≤1280 侧栏自动折叠；展开态分组可折叠，默认只展开当前位置所在分组。
 *
 * ## 不能因为换壳丢掉的行为
 *
 * - 按权限点过滤导航项；
 * - 有未保存变更时，站内跳转先确认再放行（按钮与页内 `<a href>` 都拦）；
 * - 环境标识只在非生产出现，避免把测试库当生产看。
 */

function EnvironmentTag() {
  if (IS_PROD) return null;
  const fallback = APP_ENV === 'development' ? '开发' : APP_ENV === 'test' ? '测试' : '预发';
  const label = import.meta.env.VITE_ENV_LABEL || fallback;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
      title={`当前环境: ${APP_ENV} (${label})`}
      aria-label={`当前环境: ${label}`}
    >
      <span className="size-1.5 rounded-full bg-warn-text" aria-hidden />
      {label}
    </span>
  );
}

function SidebarItem({
  item,
  collapsed,
  onNavigate,
}: {
  item: AdminMenuItem & { isActive: boolean };
  collapsed: boolean;
  onNavigate: (path: string) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.path)}
      aria-current={item.isActive ? 'page' : undefined}
      aria-label={collapsed ? `${item.label}${item.planned ? ' (待开放)' : ''}` : undefined}
      title={collapsed ? `${item.label}${item.planned ? ' (待开放)' : ''}` : undefined}
      className={cn(
        'relative flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium transition-colors outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        item.isActive
          ? 'bg-accent font-semibold text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {item.isActive && (
        <span
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
          aria-hidden
        />
      )}
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.planned && (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[12px] text-muted-foreground">
              待建
            </span>
          )}
        </>
      )}
    </button>
  );
}

export function AdminBoardLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdmin();
  const { logout } = useAuth();
  const confirm = useConfirm();

  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 1280px)').matches);
  const [openGroups, setOpenGroups] = useState<string[] | null>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_GROUPS_KEY);
      const parsed = saved ? (JSON.parse(saved) as unknown) : null;
      return Array.isArray(parsed)
        ? parsed.filter((name): name is string => typeof name === 'string')
        : null;
    } catch {
      return null;
    }
  });

  // 窄屏（后台最小使用宽度 1280）自动折叠成图标栏；初始值同步，避免首帧展开再收窄
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // 精确匹配，避免 /admin/users 同时点亮「平台概览」
  const activePath = location.pathname.replace(/\/$/, '') || '/admin';
  const currentGroup = findAdminMenuGroup(activePath);

  const permissionGroups = useMemo(
    () =>
      ADMIN_MENU.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.permission === null || can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  const groups = useMemo(() => {
    return permissionGroups.map((group) => ({
      ...group,
      open: (openGroups ?? [currentGroup?.name]).includes(group.name),
    }));
  }, [currentGroup, openGroups, permissionGroups]);

  const currentGroupName = currentGroup?.name;

  const leave = useCallback(
    async (to: string) => {
      if (hasUnsavedChanges()) {
        const answer = await confirm({
          title: '有未保存的变更',
          description: '当前页面有修改还没保存，离开后这些修改会丢失。',
          confirmText: '放弃变更并离开',
          cancelText: '留下继续编辑',
          danger: true,
        });
        if (answer === null) return;
      }
      navigate(to);
    },
    [confirm, navigate],
  );

  // 页面内的 <a href="/..."> 也走同一套未保存拦截
  const onClickCapture = (event: React.MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
    const href = anchor?.getAttribute('href') ?? '';
    if (!href.startsWith('/')) return;
    const here = `${window.location.pathname}${window.location.search}`;
    if (href === here || !hasUnsavedChanges()) return;
    event.preventDefault();
    void leave(href);
  };

  const toggleGroup = (name: string) => {
    setOpenGroups((current) =>
      (current ?? []).includes(name)
        ? (current ?? []).filter((group) => group !== name)
        : [...(current ?? []), name],
    );
  };

  useEffect(() => {
    if (currentGroupName && openGroups) {
      setOpenGroups((current) =>
        current?.includes(currentGroupName) ? current : [...(current ?? []), currentGroupName],
      );
    }
  }, [currentGroupName, openGroups]);

  useEffect(() => {
    if (openGroups) localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  return (
    <div
      className="admin-root adm-layout flex h-screen flex-col overflow-hidden bg-page"
      onClickCapture={onClickCapture}
    >
      <a
        className="adm-skip-link"
        href="#adm-main"
      >
        跳到主要内容
      </a>

      <header
        data-testid="admin-header"
        className="flex h-14 shrink-0 items-center border-b border-border bg-card px-4"
      >
        <button
          type="button"
          data-testid="admin-brand"
          className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => void leave('/admin')}
          aria-label="logon+ 运营后台首页"
        >
          <span className="truncate text-lg font-bold tracking-tight text-foreground">
            logon<span className="text-primary">+</span>
          </span>
        </button>

        <div className="ml-6 min-w-0 flex-1">
          {can('data.search') && (
            <GlobalSearch onNavigate={(path) => void leave(path)} />
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <AdminAlertBell onNavigate={(path) => void leave(path)} />
          <EnvironmentTag />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="admin-account-trigger"
                title={me?.email}
                aria-label="打开用户菜单"
                className="flex h-9 max-w-[260px] items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {(me?.email ?? 'A').charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-xs font-medium text-foreground">
                    {me?.email ?? '加载中…'}
                  </span>
                  <span className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {me?.roleLabel}
                  </span>
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" sideOffset={8} className="w-60">
              <div className="flex items-center gap-2.5 px-2 py-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {(me?.email ?? 'A').charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {me?.email ?? '加载中…'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{me?.roleLabel}</p>
                </div>
              </div>
              <DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/workbench')}>
                  <ArrowUpRight className="size-3.5" aria-hidden />
                  返回前台
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  <LogOut className="size-3.5" aria-hidden />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          data-testid="admin-sider"
          className={cn(
            'sticky top-0 flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150',
            collapsed ? 'w-[60px]' : 'w-[232px]',
          )}
          aria-label="后台导航栏"
        >
          <div
            data-testid="admin-nav-scroll"
            className="adm-nav-scroll min-h-0 flex-1 overflow-y-auto py-2.5"
          >
            <nav className="flex flex-col gap-5 px-2.5" aria-label="后台导航">
              {groups.map((group) => (
                <div key={group.name}>
                  {collapsed && (
                    <div className="mx-1.5 mb-2 h-px bg-border" aria-hidden />
                  )}
                  {!collapsed ? (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.name)}
                        aria-expanded={group.open}
                        className="flex h-7 w-full items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold tracking-wider text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        <ChevronDown
                          className={cn('size-3.5 transition-transform', !group.open && '-rotate-90')}
                          aria-hidden
                        />
                        {group.name}
                      </button>
                      {group.open && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {group.items.map((item) => (
                            <SidebarItem
                              key={item.path}
                              item={{ ...item, isActive: activePath === item.path }}
                              collapsed={collapsed}
                              onNavigate={(path) => void leave(path)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {group.items.map((item) => (
                        <SidebarItem
                          key={item.path}
                          item={{ ...item, isActive: activePath === item.path }}
                          collapsed={collapsed}
                          onNavigate={(path) => void leave(path)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>

        </aside>

        {/*
         * 内容区：`min-w-0` 缺一不可 —— 少了它，宽表会把父容器顶宽，整页出现
         * 横向滚动条；`overflow-x-auto` 把滚动限制在这一块内部。不设统一限宽：
         * 后台以数据密集页为主，限宽会让两侧留白挤压表格。
         *
         * **不能加 `self-start`**：它在交叉轴（这里就是纵向）把 main 压成内容
         * 高度，于是 `overflow-y-auto` 永远不会触发（元素自身比内容还高就没有
         * 溢出），而根节点是 `h-screen overflow-hidden` —— 结果是页面长过视口
         * 时底部被**直接裁掉且无法滚动**（34 个后台页在矮窗口下都会中招）。
         * 去掉它让 main 在 flex 行里纵向拉伸到容器高度，内部滚动才成立。
         * 横向不受影响：宽度由主轴（flex-1 + min-w-0）决定，与 `self-*` 无关。
         *
         * 值班数据（DutyContext）不在这里挂：它每 30 秒拉一次最近 100 条任务，
         * 只有概览页消费。挂外壳上等于让 30 多个无关页面陪着轮询。
         */}
        <main
          id="adm-main"
          tabIndex={-1}
          className="adm-content min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-page px-[26px] pt-[18px] pb-14 outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
