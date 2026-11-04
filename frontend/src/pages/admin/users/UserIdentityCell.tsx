import type { AdminUserRow } from './types';

/** 用户卡片的身份信息：用户名与邮箱各占一行，避免在四列布局中互相挤压。 */
export function UserIdentityCell({ user }: { user: AdminUserRow }) {
  const nickname = user.name.trim();
  const displayName = nickname && nickname !== user.email ? nickname : '未设置昵称';

  return (
    <dl className="flex min-w-0 flex-col gap-0.5">
      <div className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-baseline gap-2">
        <dt className="text-[11px] leading-5 text-muted-foreground">用户名</dt>
        <dd className="truncate text-[13px] font-semibold leading-5 text-foreground" title={displayName}>
          {displayName}
        </dd>
      </div>
      <div className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-baseline gap-2">
        <dt className="text-[11px] leading-5 text-muted-foreground">邮箱</dt>
        <dd className="truncate text-xs leading-5 text-muted-foreground" title={user.email}>
          {user.email}
        </dd>
      </div>
    </dl>
  );
}
