import '../styles/auth.css';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spinner } from '../ui';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { safeInternalPath } from '../lib/safePath';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

/**
 * 通用 OAuth 回调落地页。
 *
 * 后端不把 accessToken 放进 URL，而是回跳到这里并带一个 60s 短时 ticket；
 * 本页用 ticket 换正式会话，再写回本地凭证。这样浏览器历史/日志里不会留下
 * 可直接长期使用的 accessToken。
 */
export function OAuthCallbackPage() {
  useDocumentMeta('第三方登录 · 货觉AI', '正在完成第三方登录。');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const target = safeInternalPath(params.get('returnTo'), '/workbench');

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
      <div className="mx-auto mt-[12vh] w-[480px] max-w-[calc(100vw_-_32px)] rounded-xl bg-card px-8 py-10 text-center shadow-[0_10px_30px_rgba(35,39,74,0.12)]">
        {error ? (
          <>
            <h1 className="mx-0 mt-0 mb-3 text-xl font-semibold text-foreground">第三方登录失败</h1>
            <p className="mx-0 my-4 text-[color:var(--text-muted)]">{error}</p>
            <Button asChild variant="default" size="lg">
              <Link replace to="/login">
                返回登录
              </Link>
            </Button>
          </>
        ) : (
          <>
            <Spinner className="size-7" />
            <p className="mx-0 my-4 text-[color:var(--text-muted)]">正在完成登录…</p>
          </>
        )}
      </div>
    </div>
  );
}
