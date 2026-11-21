import { Download, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '../../ui';
import { ACCOUNT_CARD, ACCOUNT_CARD_HEAD } from './constants';
import type { OAuthProviderInfo } from './api';

/**
 * 安全与数据卡。
 *
 * 改密 / 导出 / 注销 都是一年用不了几次的动作, 合并成一行一条:
 * 原先三张卡占整页 1/3 高度, 还把「注销」抬到和「积分」同等显眼的位置。
 * 三行都只上抛意图, 具体流程 (弹窗、校验、接口) 由页面持有。
 */
export function AccountSecurityCard({
  hasPassword,
  oauthProviders,
  linkedOAuthProviders,
  linkingProvider,
  exporting,
  onChangePassword,
  onLinkOAuth,
  onExportData,
  onDeleteAccount,
}: {
  hasPassword: boolean;
  oauthProviders: OAuthProviderInfo[];
  linkedOAuthProviders: string[];
  linkingProvider: string | null;
  exporting: boolean;
  onChangePassword: () => void;
  onLinkOAuth: (provider: OAuthProviderInfo) => void;
  onExportData: () => void;
  onDeleteAccount: () => void;
}) {
  return (
    <section className={ACCOUNT_CARD}>
      <header className={ACCOUNT_CARD_HEAD}>
        <ShieldCheck size={15} aria-hidden className="flex-none text-muted-foreground" />
        <h2 className="m-0 text-sm font-semibold">安全与数据</h2>
      </header>
      <ul className="m-0 flex list-none flex-col p-0">
        <li className="flex items-center gap-5 py-3 first:pt-0 last:pb-0 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5 [&+li]:border-t [&+li]:border-[var(--border-row)]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <KeyRound size={13} aria-hidden className="flex-none text-muted-foreground" />
              登录密码
            </span>
            <span className="max-w-[760px] text-xs leading-relaxed text-muted-foreground">
              {hasPassword
                ? '修改后该账号在所有设备上的登录状态都会失效，需要重新登录。'
                : '当前为第三方登录账号，设置密码后可使用邮箱和密码登录。'}
            </span>
          </div>
          <Button onClick={onChangePassword}>{hasPassword ? '修改密码' : '设置密码'}</Button>
        </li>
        {oauthProviders.map((provider) => {
          const linked = linkedOAuthProviders.includes(provider.id);
          return (
            <li
              key={provider.id}
              className="flex items-center gap-5 border-t border-[var(--border-row)] py-3 last:pb-0 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  <ShieldCheck size={13} aria-hidden className="flex-none text-muted-foreground" />
                  {provider.name}
                </span>
                <span className="max-w-[760px] text-xs leading-relaxed text-muted-foreground">
                  {linked
                    ? `已绑定 ${provider.name}，可用于第三方快捷登录。`
                    : `绑定 ${provider.name} 后可使用该账号快捷登录。`}
                </span>
              </div>
              <Button
                disabled={linked || (linkingProvider === provider.id)}
                onClick={() => onLinkOAuth(provider)}
              >
                {linkingProvider === provider.id && <span className="state-spinner is-small" aria-hidden />}
                {linked ? '已绑定' : '绑定账号'}
              </Button>
            </li>
          );
        })}
        <li className="flex items-center gap-5 border-t border-[var(--border-row)] py-3 last:pb-0 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <Download size={13} aria-hidden className="flex-none text-muted-foreground" />
              个人数据导出
            </span>
            <span className="max-w-[760px] text-xs leading-relaxed text-muted-foreground">
              导出账号资料、项目、素材元信息、生成记录、订单、积分流水与消息（JSON）。导出不含密码哈希等内部字段；素材文件本体请到素材库单独下载。
            </span>
          </div>
          <Button disabled={exporting} onClick={onExportData}>
            {exporting && <span className="state-spinner is-small" aria-hidden />}
            导出我的数据
          </Button>
        </li>
        <li className="flex items-center gap-5 border-t border-[var(--border-row)] py-3 last:pb-0 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <ShieldAlert size={13} aria-hidden className="flex-none text-[color:var(--danger-soft-text)]" />
              注销账号
            </span>
            <span className="max-w-[760px] text-xs leading-relaxed text-muted-foreground">
              注销后账号不可恢复：作品、素材与积分将被清除，生效中的会员权益同时终止且不退款。依据会计与消费者权益相关法规，订单、支付与积分流水会以匿名化形式保留。
            </span>
          </div>
          <Button variant="destructive" onClick={onDeleteAccount}>
            注销账号
          </Button>
        </li>
      </ul>
    </section>
  );
}
