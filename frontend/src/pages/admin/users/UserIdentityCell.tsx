import type { AdminUserRow } from './types';

/** 用户卡片的身份信息：头像锚点 + 用户名/邮箱双行，避免四列布局中互相挤压。 */
export function UserIdentityCell({ user }: { user: AdminUserRow }) {
  const nickname = user.name.trim();
  const displayName = nickname && nickname !== user.email ? nickname : '未设置昵称';
  const initial = (nickname || user.email).charAt(0).toUpperCase();

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-brand"
        aria-hidden
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className="truncate text-[13px] font-semibold leading-5 text-foreground"
          title={displayName}
        >
          {displayName}
        </span>
        <span className="truncate text-xs leading-4 text-muted-foreground" title={user.email}>
          {user.email}
        </span>
      </span>
    </div>
  );
}
