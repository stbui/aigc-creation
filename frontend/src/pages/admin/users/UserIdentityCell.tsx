import type { AdminUserListResult } from '../../../types/api';

type Row = AdminUserListResult['items'][number];

/**
 * 用户列表的身份单元格。
 *
 * 邮箱是运营定位账号的主键，昵称是辅助辨认信息。两者放进同一单元格的
 * 上下两行，既避免邮箱列被截断后丢失全部上下文，也不额外增加一个窄列。
 */
export function UserIdentityCell({
  user,
  onOpen,
}: {
  user: Row;
  onOpen: () => void;
}) {
  const nickname = user.name.trim();
  const displayName = nickname && nickname !== user.email ? nickname : '未设置昵称';
  const initial = Array.from(nickname || user.email)[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1">
        <button
          type="button"
          aria-label={`查看用户 ${user.email} 详情`}
          title={user.email}
          className="block max-w-full truncate rounded text-left text-brand hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onOpen}
        >
          {user.email}
        </button>
        <span
          title={nickname || undefined}
          className="block max-w-full truncate text-[12px] leading-4 text-muted-foreground"
        >
          {displayName}
        </span>
      </span>
    </div>
  );
}
