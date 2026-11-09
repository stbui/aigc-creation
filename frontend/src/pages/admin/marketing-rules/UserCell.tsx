import { Link } from 'react-router-dom';
import { adminUserHref } from './utils';

/**
 * 列表里的「人」：姓名一行、邮箱一行，邮箱挂用户页深链。
 *
 * 邀请关系与签到记录两张表都要回答「这个人是谁」，而运营的下一步几乎总是
 * 去翻这个人的账号与积分账本 —— 让他点一下，而不是回去复制粘贴邮箱。
 */
export function UserCell({
  name,
  email,
}: {
  name: string | null | undefined;
  email: string;
}) {
  return (
    <span className="flex min-w-0 flex-col leading-[18px]">
      <span className="truncate">
        {name || <span className="text-muted-foreground">未命名用户</span>}
      </span>
      <Link
        className="truncate text-[12px] text-brand hover:underline"
        to={adminUserHref(email)}
        title={email}
      >
        {email}
      </Link>
    </span>
  );
}
