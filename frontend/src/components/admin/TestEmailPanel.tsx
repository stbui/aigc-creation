import { useId, useState } from 'react';
import { Send, ShieldCheck } from 'lucide-react';

import {
  ActionButton,
  FormField,
  Notice,
  Panel,
  TextField,
} from '~/admin-ui/radar';
import type { DeliveryChannelStatus, EmailTestResult } from '../../types/api';
import { deliveryProviderLabel, emailErrorText } from '../../lib/email-status';

/**
 * 测试发信 —— 「消息通知」与「邮箱配置」两页共用。
 *
 * 两页此前各写一份，文案与禁用条件很快分叉（一处说“会被拒绝”、一处说
 * “不会送达”，一处有权限提示、一处没有）。放在 `components/admin` 而不是
 * 任一页面目录：两页都是同一个后端端点，只是入口不同，页面目录会造成反向依赖。
 *
 * 发送前就把「这次发出去会发生什么」讲清楚（无权限 / 总开关关闭 / 只记本地 /
 * 配置不完整），发送后按三种结果分别给结论：服务商受理、仅本地记录、失败。
 * 运营据此判断要不要去查配置，而不是看到一个绿色提示就以为用户收到了。
 *
 * 收件框状态由组件自己持有：两页都不需要在别处读取这串地址。
 */
export function TestEmailPanel({
  canSend,
  channel,
  testing,
  result,
  onSend,
}: {
  /** 当前账号可发送测试邮件（两页各自按自己的权限点判定） */
  canSend: boolean;
  channel?: DeliveryChannelStatus | null;
  testing: boolean;
  result: EmailTestResult | null;
  onSend: (to: string) => void;
}) {
  const inputId = useId();
  const [to, setTo] = useState('');

  return (
    <Panel
      title="测试发信"
      note="使用当前生效配置发送测试邮件，验证发件地址、访问凭据与邮件服务是否可用。"
    >
      <div className="flex flex-col gap-3">
        {!canSend ? (
          <Notice tone="locked" title="当前账号无测试发信权限" className="mb-0">
            你可以查看和保存配置，但不能发送测试邮件。请联系具备消息通知管理权限的管理员完成验证。
          </Notice>
        ) : channel?.enabled === false ? (
          <Notice tone="warn" title="邮件通知已关闭">
            测试发信也会被拒绝。请先启用邮件通知并保存配置。
          </Notice>
        ) : channel && !channel.delivers ? (
          <Notice tone="warn" title="当前不会实际发送">
            {channel.configured
              ? '当前为本地记录模式，测试邮件不会送达收件箱。'
              : '当前通道配置不完整，测试邮件不会实际发送。请补全配置并保存后重试。'}
          </Notice>
        ) : null}

        <FormField
          label="收件邮箱"
          htmlFor={inputId}
          hint="测试邮件仅用于验证当前邮件发送配置，不会触发业务通知，也不会写入站内消息。"
        >
          <TextField
            id={inputId}
            ariaLabel="测试邮件收件邮箱"
            type="email"
            value={to}
            disabled={!canSend || testing}
            maxLength={200}
            placeholder="you@example.com"
            onChange={setTo}
            onEnter={() => {
              if (canSend && !testing && to.trim()) onSend(to.trim());
            }}
          />
        </FormField>

        <ActionButton
          variant="default"
          icon={Send}
          disabled={!canSend || testing || !to.trim()}
          onClick={() => onSend(to.trim())}
        >
          {testing ? '发送中…' : '发送测试邮件'}
        </ActionButton>

        {result ? (
          <Notice
            tone={result.ok ? (result.delivered ? 'success' : 'warn') : 'danger'}
            title={
              result.ok
                ? result.delivered
                  ? '邮件服务商已受理测试邮件'
                  : '测试邮件仅记录在本地'
                : '测试邮件发送失败'
            }
            className="mb-0"
          >
            <span className="block">
              {result.ok && result.delivered
                ? `投递通道：${deliveryProviderLabel(result.provider)}${result.messageId ? ` · 消息编号：${result.messageId}` : ''}。请检查收件箱与垃圾邮件目录；服务商受理不代表最终送达。`
                : result.ok
                  ? '投递通道：本地记录。测试邮件不会送达收件箱，请切换至可实际发送的通道后重新测试。'
                  : emailErrorText(
                      result.error,
                      `邮件未发送。投递通道：${deliveryProviderLabel(result.provider)}。请检查配置后重试。`,
                    )}
            </span>
          </Notice>
        ) : null}

        <div className="rounded-md bg-muted/40 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
          <p className="m-0 flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="size-3.5 text-success-text" aria-hidden />
            验证建议
          </p>
          <p className="m-0 mt-0.5">
            若测试失败，请依次检查发件地址审核、域名解析、访问凭据和服务商配额。测试结果不会展示密钥或邮件正文。
          </p>
        </div>
      </div>
    </Panel>
  );
}
