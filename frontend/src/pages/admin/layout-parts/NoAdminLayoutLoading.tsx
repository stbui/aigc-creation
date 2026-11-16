import { AdminLoading } from './AdminLoading';

/**
 * 身份校验期间的骨架。
 *
 * 外壳还没挂载，不能复用页面内的 `AdminLoading` —— 这里画一个与外壳同构的
 * 占位（左侧栏 + 内容区），让加载到渲染之间不发生布局跳动。
 */
export function NoAdminLayoutLoading() {
  return (
    <div className="admin-root flex min-h-screen bg-page" aria-busy="true" aria-live="polite">
      <div className="w-[232px] shrink-0 border-r border-border bg-sidebar" aria-hidden />
      <div className="min-w-0 flex-1 px-[26px] pt-[18px]">
        <AdminLoading tip="校验后台权限…" />
      </div>
    </div>
  );
}
