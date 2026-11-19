import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { ActionButton, Button } from '../../../admin-ui/primitives';

/**
 * 无后台权限页。
 *
 * 常见误入原因（按可能性排序），逐条给出以便自查：
 *   1. 用 C 端账号登录 —— 普通注册用户默认没有后台角色
 *   2. 账号被降权 —— 后台立即生效，旧 token 下次请求即 403
 *   3. 账号被禁用
 */
export function NoAdminAccess({ email }: { email: string | null }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <div className="admin-root flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-[560px] rounded-lg border border-border bg-card p-8 shadow-card">
        <h1 className="mb-2 text-xl font-semibold text-foreground">需要后台权限</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          当前账号 <strong className="text-foreground">{email ?? '(未登录)'}</strong>{' '}
          没有运营后台的访问权限。
        </p>

        <div className="mb-4 rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          <strong className="mb-1.5 block text-[13px] text-foreground">可能原因</strong>
          <ul className="m-0 list-disc pl-[18px]">
            <li className="my-0.5">使用了 C 端账号登录 —— 普通注册用户默认没有后台角色</li>
            <li className="my-0.5">账号的角色已被降权，后台权限立即生效</li>
            <li className="my-0.5">账号已被禁用</li>
          </ul>
        </div>
        <div className="mb-6 rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          <strong className="mb-1.5 block text-[13px] text-foreground">如何进入</strong>
          <ul className="m-0 list-disc pl-[18px]">
            <li className="my-0.5">
              退出后用运营账号登录：development / test 启动时会自动创建预设管理员；production
              运行{' '}
              <code className="rounded border border-border bg-card px-1 py-0.5 font-mono">
                npm run seed:admin
              </code>{' '}
              生成一次性随机密码
            </li>
            <li className="my-0.5">
              已有管理员账号但不知密码：用该账号在「用户管理 → 重置密码」获取临时密码
            </li>
          </ul>
        </div>

        <div className="flex gap-2">
          {/* 回工作台是纯导航：用链接语义，保留右键 / 新标签页 / 读屏角色 */}
          <Button asChild variant="secondary" size="sm">
            <Link to="/workbench">返回工作台</Link>
          </Button>
          <ActionButton
            variant="default"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            换个账号登录
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
