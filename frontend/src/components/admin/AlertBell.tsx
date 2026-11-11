import { Bell, LoaderCircle, RefreshCw } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../admin-ui/components/ui/dropdown-menu';
import { cn } from '../../admin-ui/lib/cn';
import { ALERT_SEVERITY_META } from './AlertCenter';
import { useAdminAlerts } from '../../hooks';

/**
 * 顶栏告警铃铛。
 *
 * 与 `/admin/alerts` 共用同一个轮询 hook，不新增第二套数据口径。铃铛角标是
 * 告警条目数而不是底层记录数；没有待处理项时不显示 0，避免长期噪音。
 */
export function AdminAlertBell({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { data, error, loading, reload } = useAdminAlerts();
  const pending = data?.total ?? 0;
  const items = data?.items.slice(0, 5) ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="admin-alert-trigger"
          aria-label={pending > 0 ? `告警中心，${pending} 项待处理` : '告警中心'}
          title={pending > 0 ? `${pending} 项待处理` : '告警中心'}
          className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Bell className="size-[18px]" aria-hidden />
          {pending > 0 && (
            <span
              data-testid="admin-alert-badge"
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger-text px-1 text-xs font-semibold leading-4 text-white"
            >
              {pending > 99 ? '99+' : pending}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-[390px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">告警中心</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading && !data
                ? '正在检查…'
                : pending > 0
                  ? `${pending} 个事项需要处理`
                  : '当前没有待处理事项'}
            </p>
          </div>
          {loading && data && (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="刷新中" />
          )}
        </div>

        {!data && loading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            正在加载告警…
          </div>
        ) : !data && error ? (
          <div className="flex min-h-28 flex-col items-center justify-center px-5 text-center">
            <p className="text-xs text-danger-text">{error}</p>
            <DropdownMenuGroup className="mt-1">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void reload();
                }}
                className="justify-center px-2 py-1 text-xs font-medium text-primary focus:text-primary"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                重试
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-medium text-foreground">没有待处理告警</p>
            <p className="mt-1 text-xs text-muted-foreground">
              工单、任务、对账、退款与备份均在正常范围内。
            </p>
          </div>
        ) : (
          <DropdownMenuGroup className="py-1.5">
            {items.map((item) => {
              const meta = ALERT_SEVERITY_META[item.severity];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={item.key}
                  onSelect={() => onNavigate(item.link)}
                  className="mx-1.5 my-0.5 flex items-start gap-3 rounded-md px-2.5 py-2.5"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                      item.severity === 'critical' && 'bg-danger-soft text-danger-text',
                      item.severity === 'warning' && 'bg-warn-soft text-warn-text',
                      item.severity === 'info' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        {item.title}
                      </span>
                      {item.count !== null && (
                        <span className="shrink-0 text-xs font-semibold text-foreground tabular-nums">
                          {item.count}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-4 text-muted-foreground">
                      {item.detail}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        )}

        {error && data && (
          <DropdownMenuGroup className="border-t border-border bg-warn-soft px-2 py-1">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void reload();
              }}
              className="whitespace-normal px-1.5 py-1.5 text-xs leading-4 text-warn-text focus:bg-accent focus:text-warn-text"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              <span className="flex-1">刷新失败，显示上次结果。{error}</span>
              <span className="shrink-0 font-medium text-primary">重试</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}

        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => onNavigate('/admin/alerts')}
            className="justify-center rounded-none border-t border-border py-2.5 text-xs font-medium text-primary focus:text-primary"
          >
            查看全部告警
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
