/**
 * 后台路由判定。
 *
 * 两个守卫都是全局注册的，只能从 URL 判断「这是不是后台请求」。
 * 这里按路径段匹配 `/admin`，而不是 `includes('/admin')`：
 * 后者会把 `/api/administrator` 这类前台路径也当成后台接口。
 *
 * 应用默认带全局前缀（`/api`），所以只匹配路径段，不要求以 `/admin` 开头。
 */
const ADMIN_SEGMENT = '/admin';

export function isAdminRequestPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0].split('#')[0];
  const index = path.indexOf(ADMIN_SEGMENT);
  if (index === -1) return false;
  const boundary = path[index + ADMIN_SEGMENT.length];
  return boundary === undefined || boundary === '/';
}
