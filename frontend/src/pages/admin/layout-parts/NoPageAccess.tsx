import { ExceptionPage } from '../../../components/ExceptionPage';
import { PERMISSION_LABELS } from '../roles/constants';

/**
 * 单页无权限页。
 *
 * 与 `NoAdminAccess` 的分工：
 *   `NoAdminAccess`   —— 整个后台都进不去（不是后台角色），整屏渲染，在布局壳之外
 *   `NoPageAccess`    —— 后台角色能进，但这一页的权限点不够，渲染在布局壳之内
 *
 * 为什么不复用页内空态：`storage` / `backups` / `scheduler` / `alerts` 这几个页面
 * 没有页内总闸，直敲 URL 会直接请求接口并渲染成接口错误页，把「你没这个权限」
 * 说成「页面坏了」。路由级守卫在渲染任何子页面之前拦下，才不会打出无权的请求。
 *
 * 文案要能自查：说明缺哪个权限点（中文标签 + 原始键名），并给出可用的返回入口。
 */
export function NoPageAccess({ path, required }: { path: string; required: string[] }) {
  const labels = required.map((permission) => PERMISSION_LABELS[permission] ?? permission);
  const desc =
    required.length === 1
      ? `当前账号没有「${labels[0]}」权限，无法打开这个页面。可以返回平台概览，或联系管理员调整角色。`
      : `当前账号缺少进入这个页面所需的权限（${labels.join(' / ')} 中任一），可以返回平台概览，或联系管理员调整角色。`;

  return (
    <div data-testid="admin-no-page-access">
      <ExceptionPage
        kind="warning"
        title="没有这个页面的访问权限"
        desc={desc}
        detail={`path: ${path}\nrequired: ${required.join(', ')}`}
        action={{ to: '/admin', label: '返回平台概览' }}
        showBack={false}
      />
    </div>
  );
}
