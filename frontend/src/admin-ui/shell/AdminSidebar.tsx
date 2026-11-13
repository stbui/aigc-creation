import { useEffect, useRef } from 'react';
import { ArrowUpRight, ChevronDown, ChevronsUpDown, LogOut } from 'lucide-react';

import { cn } from '../lib/cn';
import { Collapsible, CollapsibleContent } from '../components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '../components/ui/sidebar';
import type { AdminMenuGroup, AdminMenuItem } from '../../components/admin/adminNav';

/** 单个导航项。折叠态只留图标，名称由 `tooltip` 补位。 */
function NavItem({
  item,
  isActive,
  onNavigate,
}: {
  item: AdminMenuItem;
  isActive: boolean;
  onNavigate: (path: string) => void;
}) {
  const Icon = item.icon;
  const tooltip = item.planned ? `${item.label} (待开放)` : item.label;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={isActive}
        tooltip={tooltip}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onNavigate(item.path)}
        className={cn(
          'relative h-9 gap-2.5 px-2.5 text-sm font-medium data-[active=true]:font-semibold',
          'group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center',
        )}
      >
        {isActive && (
          <span
            className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        )}
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
        {item.planned && (
          <span className="ml-auto shrink-0 rounded-sm bg-muted px-1 text-[12px] text-muted-foreground group-data-[collapsible=icon]:hidden">
            待建
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * 导航区。
 *
 * 展开态按分组折叠（分组标题即开关）；折叠态隐藏分组标题，全部项拉平并用
 * 分隔线分组 —— 图标栏里标题没有位置。
 */
function SidebarNav({
  groups,
  activePath,
  activeGroupName,
  onNavigate,
  onToggleGroup,
}: {
  groups: Array<AdminMenuGroup & { open: boolean }>;
  activePath: string;
  activeGroupName?: string;
  onNavigate: (path: string) => void;
  onToggleGroup: (name: string) => void;
}) {
  const { state } = useSidebar();
  const navRef = useRef<HTMLDivElement>(null);

  // 深链或从页内跳转进入底部菜单时，把当前项带回可视区；只在导航状态
  // 变化时做 nearest 对齐，不抢用户正在进行的滚动手势。
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      navRef.current
        ?.querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activePath, groups, state]);

  if (state === 'collapsed') {
    return (
      <SidebarContent
        ref={navRef}
        data-testid="admin-nav-scroll"
        role="navigation"
        aria-label="后台导航"
        className="adm-nav-scroll gap-0 py-1.5"
        // shadcn 折叠态默认给导航区 `overflow-hidden`；本后台分组多，
        // 图标栏必须还能纵向滚动，否则 1280×800 下底部入口被裁掉。
        style={{ overflowX: 'hidden', overflowY: 'auto' }}
      >
        {groups.map((group, index) => (
          <div key={group.name}>
            {index > 0 && <SidebarSeparator className="my-0.5" />}
            <SidebarGroup className="px-2 py-0.5">
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <NavItem
                      key={item.path}
                      item={item}
                      isActive={activePath === item.path}
                      onNavigate={onNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
    );
  }

  return (
    <SidebarContent
      ref={navRef}
      data-testid="admin-nav-scroll"
      role="navigation"
      aria-label="后台导航"
      className="adm-nav-scroll gap-0 py-1.5"
    >
      {groups.map((group, index) => (
        <Collapsible key={group.name} open={group.open}>
          <SidebarGroup className="p-0.5">
            <SidebarGroupLabel asChild>
              <button
                type="button"
                aria-expanded={group.open}
                aria-controls={`admin-nav-group-${index}`}
                onClick={() => onToggleGroup(group.name)}
                data-active={group.name === activeGroupName ? 'true' : undefined}
                className={cn(
                  'w-full justify-between gap-2 text-sm! font-semibold tracking-[0.08em] outline-none transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  'data-[active=true]:text-sidebar-accent-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full transition-colors',
                      group.name === activeGroupName ? 'bg-primary' : 'bg-transparent',
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{group.name}</span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-3.5 shrink-0 transition-transform',
                    !group.open && '-rotate-90',
                  )}
                  aria-hidden
                />
              </button>
            </SidebarGroupLabel>
            <CollapsibleContent id={`admin-nav-group-${index}`}>
              <SidebarGroupContent className="mt-0.5 ml-8 w-auto border-l border-sidebar-border">
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <NavItem
                      key={item.path}
                      item={item}
                      isActive={activePath === item.path}
                      onNavigate={onNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      ))}
    </SidebarContent>
  );
}

/** 侧栏底部账号菜单；折叠态只留头像。 */
function AccountMenu({
  email,
  roleLabel,
  onReturnFront,
  onLogout,
}: {
  email?: string;
  roleLabel?: string;
  onReturnFront: () => void;
  onLogout: () => void;
}) {
  const initial = (email ?? 'A').charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          data-testid="admin-account-trigger"
          aria-label="打开用户菜单"
          title={email}
          className="group-data-[collapsible=icon]:mx-auto data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initial}
          </span>
          <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{email ?? '加载中…'}</span>
            <span className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {roleLabel}
            </span>
          </span>
          <ChevronsUpDown
            className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{email ?? '加载中…'}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
          </div>
        </div>
        <DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onReturnFront}>
            <ArrowUpRight className="size-3.5" aria-hidden />
            返回前台
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onLogout}>
            <LogOut className="size-3.5" aria-hidden />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 后台侧栏：品牌头 + 分组导航 + 底部账号菜单。
 *
 * 只负责导航呈现，权限过滤、未保存拦截与分组折叠状态都由外壳
 * （`AdminBoardLayout`）持有 —— 侧栏不自己读路由或权限。
 */
export function AdminSidebar({
  groups,
  activePath,
  activeGroupName,
  email,
  roleLabel,
  onNavigate,
  onToggleGroup,
  onHome,
  onReturnFront,
  onLogout,
}: {
  groups: Array<AdminMenuGroup & { open: boolean }>;
  activePath: string;
  activeGroupName?: string;
  email?: string;
  roleLabel?: string;
  onNavigate: (path: string) => void;
  onToggleGroup: (name: string) => void;
  onHome: () => void;
  onReturnFront: () => void;
  onLogout: () => void;
}) {
  return (
    <Sidebar collapsible="icon" data-testid="admin-sider">
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="货觉AI 运营后台"
              data-testid="admin-brand"
              aria-label="货觉AI 运营后台首页"
              onClick={onHome}
              className="h-10 group-data-[collapsible=icon]:mx-auto"
            >
              <img className="size-7 shrink-0" src="/brand/huojue-mark.svg" alt="" />
              <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[15px] font-semibold text-sidebar-foreground">
                  货觉AI
                </span>
                <span className="truncate text-[12px] text-muted-foreground">运营后台</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarNav
        groups={groups}
        activePath={activePath}
        activeGroupName={activeGroupName}
        onNavigate={onNavigate}
        onToggleGroup={onToggleGroup}
      />

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu
              email={email}
              roleLabel={roleLabel}
              onReturnFront={onReturnFront}
              onLogout={onLogout}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail aria-label="切换侧栏" title="切换侧栏" />
    </Sidebar>
  );
}
