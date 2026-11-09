import {
  ActionButton,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  Separator,
  StatusTag,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { formatDateTime } from './utils';
import { UserIdentityCell } from './UserIdentityCell';
import type { AdminUserRow } from './types';

export interface UserCardAction {
  key: string;
  label: string;
  danger?: boolean;
  emphasis?: 'primary';
  disabled?: boolean;
  onSelect: () => void;
}

export function UserCard({
  user,
  onOpen,
  actions,
  selected = false,
  selectable = false,
  onToggleSelected,
}: {
  user: AdminUserRow;
  onOpen: () => void;
  actions: UserCardAction[];
  selected?: boolean;
  selectable?: boolean;
  onToggleSelected?: (next: boolean) => void;
}) {
  const disabled = user.status === 'disabled';
  const actionCols =
    actions.length >= 5
      ? 'grid-cols-5'
      : actions.length === 4
        ? 'grid-cols-4'
        : 'grid-cols-3';

  return (
    <Card
      data-testid="admin-user-card"
      data-row-key={user.id}
      data-user-status={user.status}
      className={cn(
        'relative gap-0 overflow-hidden rounded-lg border-border bg-card py-0 shadow-card transition-colors hover:border-primary/40 hover:bg-accent/10 focus-within:border-primary active:bg-accent/20',
        disabled &&
          'border-warn-border bg-warn-soft/20 hover:border-warn-text/40 hover:bg-warn-soft/30 active:bg-warn-soft/40',
      )}
    >
      <button
        type="button"
        aria-label={`查看用户 ${user.email} 详情`}
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onOpen}
      />

      {selectable && (
        <div className="absolute left-3 top-3.5 z-10">
          <CheckboxField
            checked={selected}
            onChange={(next) => onToggleSelected?.(next)}
            ariaLabel={`选择用户 ${user.email}`}
          />
        </div>
      )}

      <CardHeader
        className={cn(
          'pointer-events-none grid-cols-[minmax(0,1fr)_auto] items-start gap-2 pr-4 pt-4 pb-3.5',
          selectable ? 'pl-10' : 'pl-4',
        )}
      >
        <CardTitle className="min-w-0 font-normal">
          <UserIdentityCell user={user} />
        </CardTitle>
        <div className="flex flex-col items-end gap-1">
          <StatusTag status={user.role} />
          <StatusTag status={user.status} showDot />
        </div>
      </CardHeader>

      <CardContent className={cn('pointer-events-none px-4 pb-3.5', disabled && 'opacity-65')}>
        <div className="grid grid-cols-3 divide-x divide-border/70 rounded-md bg-muted/40 px-2 py-2.5 text-center">
          <UserMetric label="项目" value={user.projectCount} />
          <UserMetric label="任务" value={user.taskCount} />
          <UserMetric label="素材" value={user.assetCount} />
        </div>

        <dl className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-2 text-xs">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">注册时间</dt>
            <dd className="mt-0.5 truncate leading-4 tabular-nums">{formatDateTime(user.createdAt)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">最近登录</dt>
            <dd className="mt-0.5 truncate leading-4 tabular-nums">
              {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '从未登录'}
            </dd>
          </div>
        </dl>
      </CardContent>

      <Separator />
      <CardFooter
        data-testid="admin-user-card-actions"
        role="group"
        aria-label="用户操作"
        className={cn(
          'relative grid items-center gap-0 bg-muted/15 px-1.5 py-1.5',
          actionCols,
        )}
      >
        {actions.map((action) => (
          <ActionButton
            key={action.key}
            variant="ghost"
            size="xs"
            className={cn(
              'h-7 w-full px-1 text-xs font-normal',
              action.danger
                ? 'text-danger-text hover:text-danger-text'
                : action.emphasis === 'primary'
                  ? 'font-medium text-primary hover:bg-primary/10 hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground',
            )}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.label}
          </ActionButton>
        ))}
      </CardFooter>
    </Card>
  );
}

function UserMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-1">
      <div className="text-[15px] font-semibold leading-5 tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs leading-3.5 text-muted-foreground">{label}</div>
    </div>
  );
}
