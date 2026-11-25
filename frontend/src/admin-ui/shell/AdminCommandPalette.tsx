import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import type { AdminMenuGroup } from '../../components/admin/adminNav';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command';

/**
 * 后台全局命令面板（2026-11-25）。
 *
 * 数据源是外壳已按权限过滤好的 `groups`（与侧栏同一份 `permissionGroups`），
 * 面板不自行读权限、不另建菜单清单——避免出现「侧栏能进、搜索不到」的错位。
 * `planned` 项（尚未实现）不进面板：搜到一个点进去只能看到占位页，是噪音。
 *
 * 快捷键 Cmd+K / Ctrl+K 在 Mac 与 Windows/Linux 都可用；对话框打开时输入
 * 焦点由 Radix Dialog 接管，关闭后自动归还触发元素。
 *
 * portal 渲染到 body，不在 `.admin-root` 内，故 DialogContent 必须显式带
 * `admin-portal` 才能继承阶段 1 的中性令牌；否则浮层会退回品牌紫。
 */
export function AdminCommandPalette({
  groups,
  onNavigate,
}: {
  groups: AdminMenuGroup[];
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 与侧栏共用同一份已过滤分组；面板只做「拍平 + 去掉未实现项」的呈现变换。
  const searchable = useMemo(
    () =>
      groups
        .map((group) => ({
          name: group.name,
          items: group.items.filter((item) => !item.planned),
        }))
        .filter((group) => group.items.length > 0),
    [groups],
  );

  return (
    <>
      <button
        type="button"
        data-testid="admin-global-search-trigger"
        aria-label="全局搜索"
        aria-keyshortcuts="Meta+K Control+K"
        title="全局搜索 (⌘K / Ctrl+K)"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden lg:inline">搜索功能…</span>
        <kbd className="ml-2 hidden rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] leading-none lg:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="全局搜索"
        description="输入功能名称，快速跳转到后台页面"
        className="admin-portal shadow-none"
      >
        <CommandInput placeholder="搜索功能、页面…" data-testid="admin-global-search-input" />
        <CommandList>
          <CommandEmpty>没有匹配的功能</CommandEmpty>
          {searchable.map((group) => (
            <CommandGroup key={group.name} heading={group.name}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.path}
                    value={`${group.name} ${item.label}`}
                    onSelect={() => {
                      setOpen(false);
                      onNavigate(item.path);
                    }}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
