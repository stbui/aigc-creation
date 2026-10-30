import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { IconButton } from '../../vendor/boardui/components/base/buttons/icon-button';
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '../../vendor/boardui/components/base/dropdown/dropdown';
import { Popover } from 'react-aria-components';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import { ADMIN_MENU } from '../../components/admin/adminNav';
import { AdminDutyProvider } from '../../components/admin/DutyContext';
import { useAdminAlerts, ALERT_SEVERITY_META, alertTime } from '../../components/admin/AlertCenter';
import { hasUnsavedChanges } from '../../lib/unsaved-guard';
import { APP_ENV, IS_PROD } from '../../lib/constants';
import { cx } from '../lib/cn';
import { useConfirm } from '../providers/ConfirmProvider';
import { AdminSearchPalette } from './AdminSearchPalette';

/**
 * 后台外壳（BoardUI）。
 *
 * ## 与旧外壳的关系
 *
 * 旧版是 `adm-shell`：216px 左栏 + 顶部值班带（概览 128px / 其余 44px）。
 * 2026-10-30 决策去掉值班带，外壳改为 BoardUI 的单栏结构：左栏导航 + 内容区，
 * 机器状态不再常驻 28 个页面，而是回到概览页首屏。
 *
 * ## 保留的行为（不能因为换壳丢）
 *
 * - 按权限点过滤导航项，待建模块仍然可见并给「待建」标记；
 * - 有未保存变更时，站内跳转先确认再放行；
 * - 密度偏好存 localStorage，旧页面通过 `adm-layout is-compact` 继续生效；
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
      className="inline-flex items-center gap-1.5 rounded-md bg-background-secondary-default px-2 py-1 text-xs text-text-secondary"
      title={`当前环境: ${APP_ENV} (${label})`}
      aria-label={`当前环境: ${label}`}
    >
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
      {!dotOnly && label}
    </span>
  );
}

/** 告警铃：复用 `useAdminAlerts`，只换渲染层，轮询与失败保留旧数据的行为不变 */
function AlertBell() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAdminAlerts();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const items = data?.items ?? [];
  const count = items.length;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={count > 0 ? `告警中心，${count} 项待处理` : '告警中心，暂无待处理'}
        className={cx(
          'relative inline-flex size-8 items-center justify-center rounded-lg text-text-secondary transition-colors',
          'hover:bg-background-secondary-hover hover:text-text-primary',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-4" aria-hidden />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-medium leading-4 text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      <Popover
        triggerRef={triggerRef}
        isOpen={open}
        onOpenChange={setOpen}
        placement="bottom end"
        offset={6}
        className="bui-scope w-[340px] rounded-xl border border-border-table bg-white p-0 shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-table px-3 py-2.5">
          <strong className="text-sm text-text-primary">待处理告警</strong>
          <span className="text-xs text-text-tertiary">{count > 0 ? `${count} 项` : '暂无'}</span>
        </div>

        {error && (
          <div className="flex items-center justify-between gap-2 border-b border-border-table bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <span className="min-w-0 truncate">{error}</span>
            <button type="button" className="shrink-0 underline" onClick={() => void reload()}>
              重试
            </button>
          </div>
        )}

        <div className="max-h-[320px] overflow-y-auto">
          {loading && !data ? (
            <p className="px-3 py-6 text-center text-xs text-text-tertiary">正在检查待处理事项…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-tertiary">
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
                  className="flex w-full items-start gap-2 border-b border-border-table px-3 py-2.5 text-left last:border-b-0 hover:bg-background-secondary-default"
                  onClick={() => {
                    setOpen(false);
                    navigate(item.link);
                  }}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-tertiary">
                      {item.detail}
                    </span>
                  </span>
                  {item.count !== null && (
                    <span className="shrink-0 text-xs font-medium text-text-secondary">{item.count}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <button
          type="button"
          className="w-full border-t border-border-table px-3 py-2 text-center text-xs text-accent-600 hover:bg-background-secondary-default"
          onClick={() => {
            setOpen(false);
            navigate('/admin/alerts');
          }}
        >
          查看全部
        </button>
      </Popover>
    </>
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
  const [compact, setCompact] = useState(
    () => localStorage.getItem(DENSITY_KEY) === 'compact',
  );

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
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
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

  const navList = (
    <nav className="flex flex-col gap-4 px-2" aria-label="后台导航">
      {groups.map((group) => (
        <div key={group.name}>
          {!collapsed && (
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
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
                  aria-label={collapsed ? `${item.label}${item.planned ? ' (待开放)' : ''}` : undefined}
                  title={collapsed ? `${item.label}${item.planned ? ' (待开放)' : ''}` : undefined}
                  className={cx(
                    'flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors',
                    isActive
                      ? 'bg-accent-100 font-medium text-accent-700'
                      : 'text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary',
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
                        <span className="shrink-0 rounded bg-background-secondary-default px-1 text-[10px] text-text-tertiary">
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
  );

  return (
    <div
      className={cx('bui-admin adm-layout min-h-screen bg-[var(--page-bg)]', compact && 'is-compact')}
      onClickCapture={onClickCapture}
    >
      <a className="adm-skip-link" href="#adm-main">
        跳到主要内容
      </a>

      <div className="flex min-h-screen">
        <aside
          className={cx(
            'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border-table bg-white transition-[width] duration-150',
            collapsed ? 'w-[60px]' : 'w-[232px]',
          )}
          aria-label="后台导航栏"
        >
          <div className="flex h-14 items-center gap-2 border-b border-border-table px-3">
            <IconButton
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              size="small"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              className="border-0 bg-transparent shadow-none"
              onClick={() => setCollapsed((value) => !value)}
            />
            <button
              type="button"
              className="flex min-w-0 items-center gap-2"
              onClick={() => void leave('/admin')}
              aria-label="货觉 AI 运营后台首页"
            >
              <img className="size-6 shrink-0" src="/brand/huojue-mark.svg" alt="" />
              {!collapsed && (
                <span className="truncate text-sm font-semibold text-text-primary">
                  货觉<span className="text-text-tertiary"> 运营后台</span>
                </span>
              )}
            </button>
          </div>

          <div className="px-2 py-2">
            {collapsed ? (
              <button
                type="button"
                aria-label="搜索（展开侧栏）"
                className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-background-secondary-hover"
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
                className="flex h-8 w-full items-center gap-2 rounded-lg border border-border-button-default bg-background-primary-default px-2 text-xs text-text-placeholder hover:border-border-button-hover"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-3.5" aria-hidden />
                <span className="flex-1 text-left">搜索用户 / 订单 / 任务</span>
                <kbd className="rounded border border-border-table bg-background-secondary-default px-1 text-[10px] text-text-tertiary">
                  ⌘K
                </kbd>
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">{navList}</div>

          <div className="flex flex-col gap-1 border-t border-border-table p-2">
            <div className={cx('flex items-center gap-1', collapsed ? 'flex-col' : 'justify-between')}>
              <EnvironmentTag dotOnly={collapsed} />
              {!collapsed && (
                <div className="flex items-center gap-1">
                  <AlertBell />
                  <button
                    type="button"
                    aria-label={compact ? '切换为宽松列表' : '切换为紧凑列表'}
                    aria-pressed={compact}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary"
                    onClick={() => {
                      const next = !compact;
                      setCompact(next);
                      localStorage.setItem(DENSITY_KEY, next ? 'compact' : 'comfortable');
                    }}
                  >
                    {compact ? <Rows3 className="size-4" aria-hidden /> : <Rows4 className="size-4" aria-hidden />}
                  </button>
                </div>
              )}
            </div>

            <Dropdown>
              <DropdownTrigger
                className={cx(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-background-secondary-hover',
                  collapsed && 'justify-center px-0',
                )}
                aria-label="打开用户菜单"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700">
                  {(me?.email ?? 'A').charAt(0).toUpperCase()}
                </span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                      {me?.roleLabel ?? '加载中'}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
                  </>
                )}
              </DropdownTrigger>
              <DropdownPopover aria-label="用户菜单" placement="top start" className="bui-scope">
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-tertiary">
                  <User className="size-3.5" aria-hidden />
                  <span className="truncate">{me?.email ?? ''}</span>
                </div>
                <DropdownDivider />
                <DropdownItem onSelect={() => navigate('/workbench')}>返回前台</DropdownItem>
                <DropdownItem
                  onSelect={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <LogOut className="size-3.5" aria-hidden />
                    退出登录
                  </span>
                </DropdownItem>
              </DropdownPopover>
            </Dropdown>
          </div>
        </aside>

        {/*
         * `.adm-content` 是旧页面依赖的容器：`> .adm-page-head` / `> .adm-filter`
         * 等直接子元素选择器靠它限宽居中。Provider 不产生 DOM，children 仍是
         * main 的直接子元素，迁移期页面不会被撑到 1600px 以外。
         *
         * 值班带已移除，但概览页仍从 DutyContext 读任务快照；P2 把数据并进
         * 概览首屏之前先保留 Provider，避免概览变成空壳。
         */}
        <main id="adm-main" tabIndex={-1} className="adm-content min-w-0 flex-1">
          <AdminDutyProvider>{children}</AdminDutyProvider>
        </main>
      </div>

      <AdminSearchPalette open={searchOpen} onOpenChange={setSearchOpen} onNavigate={navigate} />
    </div>
  );
}
