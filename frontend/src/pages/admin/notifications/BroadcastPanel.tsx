import {
  ActionButton,
  FormField,
  MiniStat,
  Notice,
  Panel,
  SwitchField,
  TextAreaField,
  TextField,
} from './components';
import type { BroadcastResult, DeliveryChannelStatusMap } from '../../../types/api';

/**
 * 全站广播：站内消息 + 可选逐人邮件。
 *
 * 发送不可撤回，所以按钮在标题或正文为空时保持禁用；邮件通道未启用时只提示
 * 「站内不受影响」，不替用户改开关。结果按站内 / 邮件提交 / 失败 / 跳过四格拆开，
 * 「已提交」不等于「已送达」。
 */
export function BroadcastPanel({
  writable,
  title,
  body,
  link,
  sendEmail,
  sending,
  result,
  emailChannel,
  onTitleChange,
  onBodyChange,
  onLinkChange,
  onSendEmailChange,
  onSend,
}: {
  writable: boolean;
  title: string;
  body: string;
  link: string;
  sendEmail: boolean;
  sending: boolean;
  result: BroadcastResult | null;
  emailChannel: DeliveryChannelStatusMap['email'] | undefined;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onLinkChange: (value: string) => void;
  onSendEmailChange: (value: boolean) => void;
  onSend: () => void;
}) {
  const ready = title.trim().length > 0 && body.trim().length > 0;

  return (
    <Panel
      title="全站广播"
      note="向当前活跃账号发送站内消息；勾选后同时逐人发送活动邮件。发送后不可撤回，请确认内容与收件范围。"
    >
      <div className="flex flex-col gap-4">
        <FormField label="标题">
          <TextField
            ariaLabel="广播标题"
            value={title}
            maxLength={80}
            showCount
            disabled={!writable}
            placeholder="如：双十一活动将于 11 月 1 日开启"
            onChange={onTitleChange}
          />
        </FormField>

        <FormField label="正文">
          <TextAreaField
            ariaLabel="广播正文"
            value={body}
            rows={4}
            maxLength={2000}
            showCount
            disabled={!writable}
            placeholder="写清楚时间、范围与用户要做什么"
            onChange={onBodyChange}
          />
        </FormField>

        <FormField
          label="跳转路径（可选）"
          hint="留空表示消息不可点击。只接受站内路径，外链请勿填写。"
        >
          <TextField
            ariaLabel="跳转路径"
            className="w-[320px]"
            value={link}
            maxLength={200}
            disabled={!writable}
            placeholder="站内相对路径，如 /packages"
            onChange={onLinkChange}
          />
        </FormField>

        <FormField
          label="同时发送邮件"
          hint="默认关闭。开启后，系统会按当前邮件事件开关和模板逐人发送，收件人之间互不可见。"
        >
          <SwitchField
            ariaLabel="同时发送邮件"
            checked={sendEmail}
            disabled={!writable || sending}
            onChange={onSendEmailChange}
          />
        </FormField>

        {sendEmail && emailChannel && (!emailChannel.enabled || !emailChannel.delivers) ? (
          <Notice tone="warn" className="mb-0">
            当前邮件通道未启用或不会实际发送。站内消息不受影响；邮件可能发送失败或不会发送。
          </Notice>
        ) : null}

        {/* 预览按用户实际看到的顺序排：标题在上、正文在下、可点击时整条可点 */}
        {ready && (
          <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <strong className="block text-foreground">{title}</strong>
            <p className="mt-1 whitespace-pre-wrap">{body}</p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <ActionButton
            variant="destructive"
            size="sm"
            disabled={!writable || !ready || sending}
            onClick={onSend}
          >
            {sending ? '发送中…' : '发送广播'}
          </ActionButton>
          {result && (
            <span className="text-[12px] text-muted-foreground">上次广播结果：{result.users} 个活跃账号</span>
          )}
        </div>

        {result ? (
          <dl className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border bg-muted/20">
            <MiniStat label="站内消息" value={result.sent} />
            <MiniStat
              label="邮件已提交"
              value={result.emailSent}
              tone={result.emailSent > 0 ? 'success' : 'muted'}
            />
            <MiniStat
              label="提交失败"
              value={result.emailFailed}
              tone={result.emailFailed > 0 ? 'danger' : 'muted'}
            />
            <MiniStat
              label="未发送"
              value={result.emailSkipped}
              tone={result.emailSkipped > 0 ? 'warn' : 'muted'}
            />
          </dl>
        ) : null}
      </div>
    </Panel>
  );
}
