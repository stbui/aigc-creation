import { useNavigate } from 'react-router-dom';
import { AuthCard } from '../components/AuthCard';

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
  return (
    <div className="login-page">
      <AuthCard
        onSuccess={() => {
          // 独立页不在 AuthContext 的弹窗体系内, 登录成功由 AuthCard 内部写入 token,
          // 这里只负责导航到工作台 (AuthCard 已在成功后回调)。
          navigate('/workbench', { replace: true });
        }}
        onCancel={() => navigate(-1)}
      />
    </div>
  );
}