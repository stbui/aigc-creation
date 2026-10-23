import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spin } from 'antd';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/**
 * 通用 OAuth 回调落地页。
 *
 * 后端不把 accessToken 放进 URL，而是回跳到这里并带一个 60s 短时 ticket；
 * 本页用 ticket 换正式会话，再写回本地凭证。这样浏览器历史/日志里不会留下
 * 可直接长期使用的 accessToken。
 */
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const rawReturnTo = params.get('returnTo') ?? '';
  const target = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : '/workbench';

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ticket = params.get('ticket');
    const queryError = params.get('error');
    if (queryError) {
      setError(queryError);
      return;
    }
    if (!ticket) {
      setError('缺少 OAuth 登录票据');
      return;
    }

    authApi
      .oauthComplete(ticket)
      .then((session) => {
        if (!session?.accessToken || !session?.user?.email) {
          setError('OAuth 登录响应缺少会话信息');
          return;
        }
        login(session.accessToken, session.user.email, session.user.role);
        navigate(target, { replace: true });
      })
      .catch((err: Error) => setError(err.message || 'OAuth 登录失败'));
  }, [params, login, navigate, target]);

  return (
    <div className="login-page">
      <div className="oauth-callback-card">
        {error ? (
          <>
            <h1>第三方登录失败</h1>
            <p>{error}</p>
            <Button type="primary" size="large" onClick={() => navigate('/login', { replace: true })}>
              返回登录
            </Button>
          </>
        ) : (
          <>
            <Spin size="large" />
            <p>正在完成登录…</p>
          </>
        )}
      </div>
    </div>
  );
}
