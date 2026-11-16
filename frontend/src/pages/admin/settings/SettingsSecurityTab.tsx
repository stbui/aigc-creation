import { Panel } from './components';

/** 安全页只有静态说明：令牌有效期与密码长度都由部署环境 / 后端校验决定，本页不可编辑。 */
export function SettingsSecurityTab() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
      <Panel title="访问令牌" note="部署环境变量 · 本页不可编辑">
        <p className="text-[13px] leading-6 text-foreground">
          访问令牌有效期由启动环境变量 <code className="rounded bg-muted px-1 py-0.5">JWT_TTL</code>{' '}
          控制。修改后需重启全部后端实例；新签发的令牌使用新有效期，已签发令牌仍按原到期时间失效。
        </p>
      </Panel>
      <Panel title="密码最小长度" note="后端校验规则 · 本页不可编辑">
        <p className="text-[13px] leading-6 text-foreground">
          注册、重置密码和修改密码均要求至少 6 位。调整规则需修改对应后端 DTO
          并重新发布服务，不能通过系统设置在线修改。
        </p>
      </Panel>
    </div>
  );
}
