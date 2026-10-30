import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthCard } from '../components/AuthCard';
import { useAuth } from '../context/AuthContext';

/**
 * 登录独立页 —— 登录卡的**兜底宿主**。
 *
 * 2026-10-19「路由对外开放 + 登录挂在顶栏按钮」后, 登录的主路径是顶栏按钮唤起
 * 弹窗 (见 `AuthContext.openLogin`); 本路由保留的原因:
 *   - 深链接 / 分享 / 书签
 *   - 兜底: 某些场景 (如移动端) 弹窗不可用时仍能进入
 * 视觉与弹窗完全一致 —— 同一个 `AuthCard` 组件, 不存在两套实现。
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [params] = useSearchParams();

  /**
   * 登录后回到哪儿。
   *
   * `redirect` 来自查询串（如扫码确认页 `/qr-login?ticket=...`）。只接受站内
   * **绝对路径**：`//evil.com` 会被浏览器当成协议相对 URL 跳走，是开放重定向的
   * 经典写法，必须挡掉。非法值一律回落工作台。
   */
  const redirect = params.get('redirect') ?? '';
  const target =
    redirect.startsWith('/') && !redirect.startsWith('//') && redirect !== '/login'
      ? redirect
      : '/workbench';

  // 已登录用户点到旧登录链接时直接回到目标页，避免误以为登录态丢失。
  if (token) return <Navigate to={target} replace />;

  return (
    <div className="login-page">
      <AuthCard
        onSuccess={() => {
          // 独立页不在 AuthContext 的弹窗体系内, 登录成功由 AuthCard 内部写入 token,
          // 这里只负责导航 (AuthCard 已在成功后回调)。
          navigate(target, { replace: true });
        }}
        onCancel={() => navigate(-1)}
      />
    </div>
  );
}
