import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUILTIN_CODES } from './constants';
import { useAdmin, useUnsavedGuard, useToast, useAdminResource } from './hooks';
import { adminNotificationsApi } from './api';
import { emailErrorText } from './utils';
import { BroadcastPanel } from './BroadcastPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { TemplateDrawer, type TemplateForm } from './TemplateDrawer';
import { templateColumns } from './columns';

import {
  ActionButton,
  AdminDataTable,
  AdminPage,
  Panel,
  StaleError,
  TestEmailPanel,
} from './components';
import '../../../styles/radar-admin.css';
import type {
  BroadcastResult,
  DeliveryChannelStatusMap,
  EmailTestResult,
  MessageTemplateItem,
} from '../../../types/api';

/**
 * 消息通知。
 *
 * 四块互不相干的数据放在一页，但失败域必须彼此隔离：
 *   · 投递通道是**只读事实**，拉取失败就整块不渲染 —— 绝不能让「读失败」
 *     看起来像「通道正常」；
 *   · 广播按活跃账号逐条写入，不可撤回，因此按钮在缺少标题或正文时保持禁用；
 *   · 模板列表失败只影响模板区，不影响上面两块。
 *
 * 页面只持有跨区块的状态与请求；四块面板与模板表列定义各自独立成文件，
 * 校验与文案跟着各自的组件走。
 */
export function AdminNotificationsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('message.write');

  /* ── 广播 ── */
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentResult, setSentResult] = useState<BroadcastResult | null>(null);

  /* ── 模板 ── */
  const [editing, setEditing] = useState<MessageTemplateItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TemplateForm>({
    code: '',
    channel: 'inapp',
    subject: '',
    body: '',
    enabled: true,
  });
  const [formBase, setFormBase] = useState<TemplateForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── 投递通道状态（只读） ── */
  const [channels, setChannels] = useState<DeliveryChannelStatusMap | null>(null);
  const [channelsError, setChannelsError] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(true);

  /* ── 测试邮件 ── */
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<EmailTestResult | null>(null);

  const { data, loading, error, reload } = useAdminResource(() => adminNotificationsApi.templates());
  const templates = data ?? [];

  const formDirty = Boolean(
    formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase),
  );
  useUnsavedGuard(formDirty);

  /*
   * 通道状态单独拉: 它失败不该把模板列表也拖成错误态（反之亦然）。
   * 拉不到就整块不显示 —— 页面绝不能因为「读不到状态」就暗示「通道正常」。
   */
  const reloadChannels = () => {
    setChannelsLoading(true);
    adminNotificationsApi
      .channels()
      .then((next) => {
        setChannels(next);
        setChannelsError(false);
      })
      .catch(() => {
        setChannels(null);
        setChannelsError(true);
      })
      .finally(() => setChannelsLoading(false));
  };

  useEffect(() => {
    void reloadChannels();
  }, []);

  const doBroadcast = async () => {
    setSending(true);
    try {
      const res = await adminNotificationsApi.broadcast({
        title: title.trim(),
        body: body.trim(),
        ...(link.trim() ? { link: link.trim() } : {}),
        sendEmail,
      });
      setSentResult(res);
      toast.success(
        sendEmail
          ? `已向 ${res.users} 个活跃账号发送：站内消息 ${res.sent} 条，邮件 ${res.emailSent} 封已提交`
          : `已向 ${res.users} 个活跃账号发送 ${res.sent} 条站内消息`,
      );
      setTitle('');
      setBody('');
      setLink('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const doTestEmail = async (to: string) => {
    if (!to) return;
    setTestingEmail(true);
    setEmailTestResult(null);
    try {
      const result = await adminNotificationsApi.testEmail(to);
      setEmailTestResult(result);
      if (!result.ok) {
        toast.error('测试邮件发送失败', emailErrorText(result.error));
      } else if (result.delivered) {
        toast.success(
          '测试邮件已提交至邮件服务商',
          '请检查收件箱与垃圾邮件目录；服务商受理不代表最终送达。',
        );
      } else {
        toast.warning('测试邮件已记录在本地', '当前通道不会实际发送邮件。');
      }
    } catch (e) {
      toast.error(
        '测试邮件发送失败',
        e instanceof Error ? e.message : '请检查邮箱配置后重试。',
      );
    } finally {
      setTestingEmail(false);
    }
  };

  const openCreate = (base?: MessageTemplateItem) => {
    setEditing(base ?? null);
    const next: TemplateForm = base
      ? { code: base.code, channel: base.channel, subject: base.subject ?? '', body: base.body, enabled: base.enabled }
      : { code: '', channel: 'inapp', subject: '', body: '', enabled: true };
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  const saveTemplate = async () => {
    const code = form.code.trim();
    if (!code) return setFormError('请填写模板编码');
    if (!form.body.trim()) return setFormError('模板正文不能为空');
    setSaving(true);
    setFormError(null);
    try {
      await adminNotificationsApi.upsertTemplate({
        code,
        channel: form.channel,
        subject: form.subject.trim() || undefined,
        body: form.body,
        enabled: form.enabled,
      });
      toast.success('模板已保存');
      setFormOpen(false);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const emailChannel = channels?.email;

  return (
    <AdminPage
      title="消息通知"
      description="发送全站活动消息，并维护注册、支付、积分、工单等业务通知模板。"
      actions={
        <div className="flex items-center gap-2">
          <ActionButton asChild variant="outline" size="sm">
            <Link to="/admin/email">邮箱配置</Link>
          </ActionButton>
          {writable ? (
            <ActionButton variant="default" size="sm" onClick={() => openCreate()}>
              新建模板
            </ActionButton>
          ) : null}
        </div>
      }
    >
      {/*
        通道状态来自当前生效配置。邮箱配置可跳转独立配置页，保存后立即生效；
        短信由部署环境配置决定。读不到时明确显示失败，不能把「读失败」伪装成「通道正常」。
      */}
      <ChannelsPanel
        channels={channels}
        loading={channelsLoading}
        error={channelsError}
        onReload={reloadChannels}
      />

      <TestEmailPanel
        canSend={writable}
        channel={emailChannel}
        testing={testingEmail}
        result={emailTestResult}
        onSend={(to) => void doTestEmail(to)}
      />

      <BroadcastPanel
        writable={writable}
        title={title}
        body={body}
        link={link}
        sendEmail={sendEmail}
        sending={sending}
        result={sentResult}
        emailChannel={emailChannel}
        onTitleChange={setTitle}
        onBodyChange={setBody}
        onLinkChange={setLink}
        onSendEmailChange={setSendEmail}
        onSend={() => void doBroadcast()}
      />

      <Panel
        title="消息模板"
        note="同一业务事件可分别维护站内消息与邮件模板；模板未配置或已停用时，系统将使用内置文案。"
      >
        {error && templates.length > 0 && (
          <StaleError error={error} onRetry={() => void reload()} />
        )}
        {/*
         * 模板总量小（内置 5 条 + 运营自建），后端一次全量返回，因此不做分页：
         * 分页器只会在「只有一页」时占掉一整行。
         */}
        <AdminDataTable<MessageTemplateItem>
          rows={templates}
          columns={templateColumns(writable, openCreate)}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          minWidth={860}
          emptyText="暂无消息模板。系统将优先使用已启用模板；模板缺失时自动使用内置文案。"
        />
        <p className="mt-3 text-[12px] leading-4 text-muted-foreground">
          变量用 <code className="font-mono">{'{name}'}</code> 占位，仅替换通知调用方传入的字段。当前业务编码：
          {BUILTIN_CODES.map((c) => ` ${c.code}`).join('、')}。模板按“编码 + 通道”独立生效；
          注册验证码与找回密码属于安全邮件，请在“邮箱配置 → 邮件模板”中维护。
        </p>
      </Panel>

      <TemplateDrawer
        open={formOpen}
        editing={editing}
        form={form}
        dirty={formDirty}
        saving={saving}
        formError={formError}
        onClose={() => setFormOpen(false)}
        onSubmit={() => void saveTemplate()}
        onFormChange={setForm}
      />
    </AdminPage>
  );
}
