import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import { Separator } from '../components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '../components/ui/sidebar';
import { AdminSidebar } from './AdminSidebar';
import { useAdmin } from '../../context/AdminContext';
import { useAuth } from '../../context/AuthContext';
import {
  ADMIN_MENU,
  findAdminMenuGroup,
  findAdminMenuItem,
} from '../../components/admin/adminNav';
import { hasUnsavedChanges } from '../../lib/unsaved-guard';
import { APP_ENV, IS_PROD } from '../../lib/constants';
import { useConfirm } from '../providers/ConfirmProvider';
import { AdminAlertBell } from '../../components/admin/AlertBell';

const SIDEBAR_GROUPS_KEY = 'huojue.admin.sidebar-groups';

/**
 * 分组改名前的 localStorage 值。侧栏展开状态按组名字符串持久化，改名后旧值
 * 会失配、用户已保存的展开态被重置；读档时一次性映射到新组名。
 */
const LEGACY_SIDEBAR_GROUP_NAMES: Record<string, string> = {
  '模型': '模型与渠道',
  '内容': '内容与合规',
};

/**
 * 后台外壳。
 *
 * ## 结构
 *
 * 基于 shadcn `Sidebar` 组合：侧栏占满视口高度（展开 232 / 折叠 60，≤1280 自动
 * 折叠），内容区 `SidebarInset` 顶部是 56px 顶栏（折叠开关 + 分组 / 页面面包屑 +
 * 告警铃铛 / 环境标识），下方是页面滚动区。账号菜单放在侧栏底部。
 * 侧栏本身见 `AdminSidebar`。
 *
 * ## 不能因为换壳丢掉的行为
 *
 * - 按权限点过滤导航项；
 * - 有未保存变更时，站内跳转先确认再放行（按钮与页内 `<a href>` 都拦）；
 * - 环境标识只在非生产出现，避免把测试库当生产看；
 * - 分组展开状态写入 localStorage，首次进入默认全展开。
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

export function AdminBoardLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdmin();
  const { logout } = useAuth();
  const confirm = useConfirm();

  const [collapsed, setCollapsed] = useState(() =>
    window.matchMedia('(max-width: 1280px)').matches,
  );
  const [openGroups, setOpenGroups] = useState<string[] | null>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_GROUPS_KEY);
      const parsed = saved ? (JSON.parse(saved) as unknown) : null;
      if (!Array.isArray(parsed)) return null;
      const names = parsed
        .filter((name): name is string => typeof name === 'string')
        .map((name) => LEGACY_SIDEBAR_GROUP_NAMES[name] ?? name);
      return [...new Set(names)];
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
  const currentItem = findAdminMenuItem(activePath);

  const permissionGroups = useMemo(
    () =>
      ADMIN_MENU.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.permission === null) return true;
          return Array.isArray(item.permission)
            ? item.permission.some((permission) => can(permission))
            : can(item.permission);
        }),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  const groups = useMemo(
    () =>
      permissionGroups.map((group) => ({
        ...group,
        open: openGroups === null || openGroups.includes(group.name),
      })),
    [openGroups, permissionGroups],
  );

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
    setOpenGroups((current) => {
      // 未保存偏好时全部分组都是展开的；首次切换要基于“全部已展开”
      // 计算，否则会误把其余分组一起收起。
      const expanded = current ?? groups.map((group) => group.name);
      return expanded.includes(name)
        ? expanded.filter((group) => group !== name)
        : [...expanded, name];
    });
  };

  // 路由切换时确保当前分组可见；不在 openGroups 变化时重复跑，否则用户
  // 主动收起当前分组后会被立即重新展开。
  useEffect(() => {
    if (!currentGroupName) return;
    setOpenGroups((current) => {
      if (current === null || current.includes(currentGroupName)) return current;
      return [...current, currentGroupName];
    });
  }, [currentGroupName]);

  useEffect(() => {
    if (openGroups) localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      className="admin-root adm-layout h-svh overflow-hidden"
      style={
        {
          '--sidebar-width': '232px',
          '--sidebar-width-icon': '60px',
        } as CSSProperties
      }
      onClickCapture={onClickCapture}
    >
      <a className="adm-skip-link" href="#adm-main">
        跳到主要内容
      </a>

      <AdminSidebar
        groups={groups}
        activePath={activePath}
        email={me?.email}
        roleLabel={me?.roleLabel}
        onNavigate={(path) => void leave(path)}
        onToggleGroup={toggleGroup}
        onHome={() => void leave('/admin')}
        onReturnFront={() => navigate('/workbench')}
        onLogout={() => {
          logout();
          navigate('/login');
        }}
      />

      <SidebarInset className="min-w-0 overflow-hidden bg-page">
        <header
          data-testid="admin-header"
          className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4"
        >
          <SidebarTrigger className="-ml-1" aria-label="切换侧栏" />
          <Separator orientation="vertical" className="mr-2 h-4" />

          {currentGroup && currentItem && (
            <Breadcrumb data-testid="admin-breadcrumb" className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem className="hidden shrink-0 md:block">
                  <span className="text-muted-foreground">{currentGroup.name}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate font-medium">
                    {currentItem.label}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          )}

          <div className="ml-auto flex items-center gap-3">
            <AdminAlertBell onNavigate={(path) => void leave(path)} />
            <EnvironmentTag />
          </div>
        </header>

        {/*
         * 内容区：`min-w-0` 缺一不可 —— 少了它，宽表会把父容器顶宽，整页出现
         * 横向滚动条；`overflow-x-auto` 把滚动限制在这一块内部。不设统一限宽：
         * 后台以数据密集页为主，限宽会让两侧留白挤压表格。
         *
         * `min-h-0` 让它在纵向 flex 列里可以收缩；配合 `overflow-y-auto`，
         * 页面长过视口时在内容区内部滚动，顶栏保持固定。
         */}
        <div
          id="adm-main"
          tabIndex={-1}
          className="adm-content min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto bg-page px-[26px] pt-[18px] pb-14 outline-none"
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
