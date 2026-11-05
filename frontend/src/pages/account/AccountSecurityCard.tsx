import { Download, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '../../ui';
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
    <section className="account-card">
      <header className="account-card-head">
        <ShieldCheck size={15} aria-hidden />
        <h2>安全与数据</h2>
      </header>
      <ul className="account-actions">
        <li>
          <div className="account-action-text">
            <span className="account-action-title">
              <KeyRound size={13} aria-hidden />
              登录密码
            </span>
            <span className="account-action-desc">
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
            <li key={provider.id}>
              <div className="account-action-text">
                <span className="account-action-title">
                  <ShieldCheck size={13} aria-hidden />
                  {provider.name}
                </span>
                <span className="account-action-desc">
                  {linked
                    ? `已绑定 ${provider.name}，可用于第三方快捷登录。`
                    : `绑定 ${provider.name} 后可使用该账号快捷登录。`}
                </span>
              </div>
              <Button
                disabled={linked}
                loading={linkingProvider === provider.id}
                onClick={() => onLinkOAuth(provider)}
              >
                {linked ? '已绑定' : '绑定账号'}
              </Button>
            </li>
          );
        })}
        <li>
          <div className="account-action-text">
            <span className="account-action-title">
              <Download size={13} aria-hidden />
              个人数据导出
            </span>
            <span className="account-action-desc">
              导出账号资料、项目、素材元信息、生成记录、订单、积分流水与消息（JSON）。导出不含密码哈希等内部字段；素材文件本体请到素材库单独下载。
            </span>
          </div>
          <Button loading={exporting} onClick={onExportData}>
            导出我的数据
          </Button>
        </li>
        <li className="is-danger">
          <div className="account-action-text">
            <span className="account-action-title">
              <ShieldAlert size={13} aria-hidden />
              注销账号
            </span>
            <span className="account-action-desc">
              注销后账号不可恢复：作品、素材与积分将被清除，生效中的会员权益同时终止且不退款。依据会计与消费者权益相关法规，订单、支付与积分流水会以匿名化形式保留。
            </span>
          </div>
          <Button danger onClick={onDeleteAccount}>
            注销账号
          </Button>
        </li>
      </ul>
    </section>
  );
}
