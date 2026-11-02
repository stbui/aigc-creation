import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Rows4,
  Search,
  User,
} from 'lucide-react';

import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { ADMIN_MENU } from '../../components/admin/adminNav';
import {
  ALERT_SEVERITY_META,
  alertTime,
  useAdminAlerts,
} from '../../components/admin/AlertCenter';
import { hasUnsavedChanges } from '../../lib/unsaved-guard';
import { APP_ENV, IS_PROD } from '../../lib/constants';
import { DensityContext } from '../lib/density';
import { useConfirm } from '../providers/ConfirmProvider';
import { AdminSearchPalette } from './AdminSearchPalette';

/**
 * 后台外壳。
 *
 * ## 结构
 *
 * 单栏：侧栏导航 + 内容区（232 / 折叠 60，≤1280 自动折叠）。无顶栏 ——
 * 后台以数据密集页为主，顶栏会挤掉一整行表格的宽度。
 *
 * ## 不能因为换壳丢掉的行为
 *
 * - 按权限点过滤导航项；
 * - 有未保存变更时，站内跳转先确认再放行（按钮与页内 `<a href>` 都拦）；
 * - 密度偏好存 localStorage，经 `DensityContext` 下发给所有表格；
 * - 环境标识只在非生产出现，避免把测试库当生产看；
 * - 告警铃 60 秒轮询，页面不可见时跳过。
 */

const DENSITY_KEY = 'huojue.admin.density';

function EnvironmentTag({ dotOnly = false }: { dotOnly?: boolean }) {
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
      {!dotOnly && label}
    </span>
  );
}

/** 告警铃：复用 `useAdminAlerts`，只换渲染层；轮询与「失败保留旧数据」不变。 */
function AlertBell() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAdminAlerts();
  const [open, setOpen] = useState(false);

  const items = data?.items ?? [];
  const count = items.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `告警中心，${count} 项待处理` : '告警中心，暂无待处理'}
          className={cn(
            'relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
        >
          <Bell className="size-4" aria-hidden />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-medium text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[340px] gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <strong className="text-sm text-foreground">待处理告警</strong>
          <span className="text-xs text-muted-foreground">{count > 0 ? `${count} 项` : '暂无'}</span>
        </div>

        {error && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-danger-soft px-3 py-2 text-xs text-danger-text">
            <span className="min-w-0 truncate">{error}</span>
            <button type="button" className="shrink-0 underline" onClick={() => void reload()}>
              重试
            </button>
          </div>
        )}

        <div className="max-h-[320px] overflow-y-auto">
          {loading && !data ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              正在检查待处理事项…
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {data ? `截至 ${alertTime(data.generatedAt)} · 每 60 秒检查` : '每 60 秒检查一次'}
            </p>
          ) : (
            items.slice(0, 5).map((item) => {
              const meta = ALERT_SEVERITY_META[item.severity];
              const Icon = meta.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  title={item.detail}
                  className="flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted"
                  onClick={() => {
                    setOpen(false);
                    navigate(item.link);
                  }}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {item.detail}
                    </span>
                  </span>
                  {item.count !== null && (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <button
          type="button"
          className="w-full border-t border-border px-3 py-2 text-center text-xs text-primary hover:bg-muted"
          onClick={() => {
            setOpen(false);
            navigate('/admin/alerts');
          }}
        >
          查看全部
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function AdminBoardLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdmin();
  const { logout } = useAuth();
  const confirm = useConfirm();

  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [compact, setCompact] = useState(() => localStorage.getItem(DENSITY_KEY) === 'compact');

  // 窄屏（后台最小使用宽度 1280）自动折叠成图标栏
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const groups = useMemo(
    () =>
      ADMIN_MENU.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.permission === null || can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  // 精确匹配，避免 /admin/users 同时点亮「平台概览」
  const activePath = location.pathname.replace(/\/$/, '') || '/admin';

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

  return (
    <div className="admin-root adm-layout min-h-screen bg-page" onClickCapture={onClickCapture}>
      <a
        className="adm-skip-link"
        href="#adm-main"
      >
        跳到主要内容
      </a>

      <div className="flex min-h-screen">
        <aside
          data-testid="admin-sider"
          className={cn(
            'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150',
            collapsed ? 'w-[60px]' : 'w-[232px]',
          )}
          aria-label="后台导航栏"
        >
          <div
            data-testid="admin-sider-head"
            className="flex h-14 items-center gap-2 border-b border-border px-3"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden />
              )}
            </Button>
            <button
              type="button"
              className="flex min-w-0 items-center gap-2"
              onClick={() => void leave('/admin')}
              aria-label="货觉 AI 运营后台首页"
            >
              <img className="size-6 shrink-0" src="/brand/huojue-mark.svg" alt="" />
              {!collapsed && (
                <span className="truncate text-sm font-semibold text-foreground">
                  货觉<span className="text-muted-foreground"> 运营后台</span>
                </span>
              )}
            </button>
          </div>

          <div className="px-2 py-2">
            {collapsed ? (
              <button
                type="button"
                aria-label="搜索（展开侧栏）"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setCollapsed(false);
                  setSearchOpen(true);
                }}
              >
                <Search className="size-4" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground transition-colors hover:border-ring/40"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-3.5" aria-hidden />
                <span className="flex-1 text-left">搜索用户 / 订单 / 任务</span>
                <kbd className="rounded-sm border border-border bg-muted px-1 text-[10px] text-muted-foreground">
                  ⌘K
                </kbd>
              </button>
            )}
          </div>

          <div data-testid="admin-nav-scroll" className="min-h-0 flex-1 overflow-y-auto py-1">
            <nav className="flex flex-col gap-4 px-2" aria-label="后台导航">
              {groups.map((group) => (
                <div key={group.name}>
                  {!collapsed && (
                    <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {group.name}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const isActive = activePath === item.path;
                      return (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => void leave(item.path)}
                          aria-current={isActive ? 'page' : undefined}
                          aria-label={
                            collapsed
                              ? `${item.label}${item.planned ? ' (待开放)' : ''}`
                              : undefined
                          }
                          title={collapsed ? `${item.label}${item.planned ? ' (待开放)' : ''}` : undefined}
                          className={cn(
                            'flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors outline-none',
                            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            isActive
                              ? 'bg-accent font-medium text-accent-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            collapsed && 'justify-center px-0',
                          )}
                        >
                          {collapsed ? (
                            <span className="text-[11px] font-medium" aria-hidden>
                              {item.short ?? item.label.slice(0, 2)}
                            </span>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {item.planned && (
                                <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                                  待建
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>

          <div className="flex flex-col gap-1 border-t border-border p-2">
            <div
              className={cn(
                'flex items-center gap-1',
                collapsed ? 'flex-col' : 'justify-between',
              )}
            >
              <EnvironmentTag dotOnly={collapsed} />
              {!collapsed && (
                <div className="flex items-center gap-1">
                  <AlertBell />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={compact ? '切换为宽松列表' : '切换为紧凑列表'}
                    aria-pressed={compact}
                    onClick={() => {
                      const next = !compact;
                      setCompact(next);
                      localStorage.setItem(DENSITY_KEY, next ? 'compact' : 'comfortable');
                    }}
                  >
                    {compact ? (
                      <Rows3 className="size-4" aria-hidden />
                    ) : (
                      <Rows4 className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    collapsed && 'justify-center px-0',
                  )}
                  aria-label="打开用户菜单"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {(me?.email ?? 'A').charAt(0).toUpperCase()}
                  </span>
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {me?.roleLabel ?? '加载中'}
                      </span>
                      <ChevronDown
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
                  <User className="size-3.5" aria-hidden />
                  <span className="truncate">{me?.email ?? ''}</span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/workbench')}>
                  返回前台
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  <LogOut className="size-3.5" aria-hidden />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/*
         * 内容区：`min-w-0` 缺一不可 —— 少了它，宽表会把父容器顶宽，整页出现
         * 横向滚动条；`overflow-x-auto` 把滚动限制在这一块内部。不设统一限宽：
         * 后台以数据密集页为主，限宽会让两侧留白挤压表格。
         *
         * 密度偏好只包页面内容：外壳自身没有表格，挂外层只会让「开关作用域」变含糊。
         *
         * 值班数据（DutyContext）不在这里挂：它每 30 秒拉一次最近 100 条任务，
         * 只有概览页消费。挂外壳上等于让 30 多个无关页面陪着轮询。
         */}
        <main
          id="adm-main"
          tabIndex={-1}
          className="adm-content min-w-0 flex-1 self-start overflow-x-auto bg-page px-[26px] pt-[18px] pb-14 outline-none"
        >
          <DensityContext.Provider value={compact ? 'compact' : 'comfortable'}>
            {children}
          </DensityContext.Provider>
        </main>
      </div>

      <AdminSearchPalette open={searchOpen} onOpenChange={setSearchOpen} onNavigate={navigate} />
    </div>
  );
}
