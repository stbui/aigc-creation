import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHANNEL_LABEL, CHANNEL_OPTIONS, BUILTIN_CODES } from './constants';
import { fmtTime } from './utils';
import { useAdmin, useDiscardConfirm, useUnsavedGuard, useToast, useAdminResource } from './hooks';
import { adminNotificationsApi } from '../../../lib/api';
import { deliveryProviderLabel, emailErrorText } from '../email/constants';

import { ActionButton, AdminDataTable, AdminPage, FormDrawer, FormField, MiniStat, Notice, Panel, SelectField, StaleError, StatusTag, SwitchField, TextAreaField, TextField, type AdminColumn } from '~/admin-ui/primitives';
import type { BroadcastResult, DeliveryChannelStatusMap, EmailTestResult, MessageTemplateItem } from '../../../types/api';

/** 业务通知实际读取的模板编码 —— 与通知服务内置兜底文案一一对应 */

/**
 * 消息通知。
 *
 * 四块互不相干的数据放在一页，但失败域必须彼此隔离：
 *   · 投递通道是**只读事实**，拉取失败就整块不渲染 —— 绝不能让「读失败」
 *     看起来像「通道正常」；
 *   · 广播按活跃账号逐条写入，不可撤回，因此按钮在缺少标题或正文时保持禁用；
 *   · 模板列表失败只影响模板区，不影响上面两块。
 *
 * 渲染层：模板表 → `AdminDataTable`（自带骨架 / 错误 / 空态），
 * 右侧抽屉 → `FormDrawer`（操作区固定，长正文不把按钮滚走），
 * 开关 → `SwitchField`（`isSelected` 与 `checked` 的命名差异收在控件层）。
 */
export function AdminNotificationsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const navigate = useNavigate();
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
  const [form, setForm] = useState({
    code: '',
    channel: 'inapp' as MessageTemplateItem['channel'],
    subject: '',
    body: '',
    enabled: true,
  });
  const [formBase, setFormBase] = useState<typeof form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── 投递通道状态（只读） ── */
  const [channels, setChannels] = useState<DeliveryChannelStatusMap | null>(null);
  const [channelsError, setChannelsError] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(true);

  /* ── 测试邮件 ── */
  const [testEmail, setTestEmail] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<EmailTestResult | null>(null);

  const { data, loading, error, reload } = useAdminResource(() => adminNotificationsApi.templates());
  const templates = data ?? [];

  const formDirty = Boolean(
    formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase),
  );
  useUnsavedGuard(formDirty);
  const requestCloseForm = useDiscardConfirm(formDirty, () => setFormOpen(false));

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

  const doTestEmail = async () => {
    const to = testEmail.trim();
    if (!to) {
      toast.error('请输入测试收件邮箱');
      return;
    }
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
    const next =
      base
        ? { code: base.code, channel: base.channel, subject: base.subject ?? '', body: base.body, enabled: base.enabled }
        : { code: '', channel: 'inapp' as MessageTemplateItem['channel'], subject: '', body: '', enabled: true };
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

  const columns: Array<AdminColumn<MessageTemplateItem>> = [
    {
      key: 'code',
      title: '编码',
      width: 180,
      render: (row) => <code className="font-mono text-[12px] text-foreground">{row.code}</code>,
    },
    {
      key: 'channel',
      title: '通道',
      width: 100,
      render: (row) => CHANNEL_LABEL[row.channel] ?? row.channel,
    },
    {
      key: 'subject',
      title: '标题',
      width: 180,
      render: (row) => (
        <span className="block max-w-[180px] truncate" title={row.subject ?? undefined}>
          {row.subject || '—'}
        </span>
      ),
    },
    {
      key: 'body',
      title: '正文',
      render: (row) => (
        <span className="block max-w-[420px] truncate text-muted-foreground" title={row.body}>
          {row.body}
        </span>
      ),
    },
    {
      key: 'enabled',
      title: '状态',
      width: 90,
      render: (row) => (
        <StatusTag status={row.enabled ? 'active' : 'disabled'} label={row.enabled ? '启用' : '停用'} />
      ),
    },
    { key: 'updatedAt', title: '更新时间', width: 170, render: (row) => fmtTime(row.updatedAt) },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <ActionButton variant="ghost" size="sm" onClick={() => openCreate(row)}>
            编辑
          </ActionButton>
        ) : null,
    },
  ];

  const broadcastReady = title.trim().length > 0 && body.trim().length > 0;
  const emailChannel = channels?.email;

  return (
    <AdminPage
      title="消息通知"
      description="发送全站活动消息，并维护注册、支付、积分、工单等业务通知模板。"
      actions={
        <div className="flex items-center gap-2">
          <ActionButton variant="outline" size="sm" onClick={() => navigate('/admin/email')}>
            邮箱配置
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
    {channelsLoading ? (
      <Panel title="投递通道" note="正在读取当前生效通道…">
        <p className="text-[12px] text-muted-foreground">读取中，请稍候。</p>
      </Panel>
    ) : channelsError ? (
      <Panel title="投递通道" note="无法确认当前是否真实投递">
        <Notice tone="danger" title="通道状态读取失败" className="mb-0">
          请刷新重试；在状态恢复前，请勿将“发送成功”视为用户已收到。
          <ActionButton variant="ghost" size="xs" className="ml-2" onClick={() => navigate('/admin/email')}>
            打开邮箱配置
          </ActionButton>
        </Notice>
      </Panel>
    ) : channels ? (
      <Panel
        title="投递通道"
        note="邮箱配置保存后立即生效；短信通道由部署环境配置决定"
        extra={
          <ActionButton variant="ghost" size="xs" onClick={reloadChannels}>
            刷新状态
          </ActionButton>
        }
      >
        <ul className="flex flex-col gap-2.5">
          {(
            [
              { label: '邮件', channel: 'email' as const, st: channels.email, target: channels.email.from },
              { label: '短信', channel: 'sms' as const, st: channels.sms, target: channels.sms.sign },
            ] as const
          ).map(({ label, channel, st, target }) => (
            <li key={label} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="w-10 shrink-0 font-medium text-foreground">{label}</span>
              <StatusTag
                status={st.enabled === false ? 'disabled' : st.delivers ? 'active' : 'disabled'}
                label={
                  st.enabled === false
                    ? '已关闭'
                    : st.delivers
                      ? `可实际发送 · ${deliveryProviderLabel(st.provider, channel)}`
                      : st.configured
                        ? `本地记录 · ${deliveryProviderLabel(st.provider, channel)}`
                        : '配置不完整'
                }
              />
              {target ? (
                <span className="font-mono text-[12px] text-muted-foreground">{target}</span>
              ) : null}
              {st.enabled !== false && !st.configured ? (
                <span className="text-warn-text">配置不完整，当前不会实际发送</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    ) : null}

    <Panel
      title="测试发信"
      note="使用当前生效配置发送测试邮件，验证发件地址、访问凭据与邮件服务是否可用。"
    >
      <div className="flex flex-col gap-3">
        {emailChannel && !emailChannel.enabled ? (
          <Notice tone="warn" title="邮件通知总开关已关闭">
            验证码、找回密码与业务通知将暂停发送。请先前往“邮箱配置”启用并保存。
          </Notice>
        ) : emailChannel && !emailChannel.delivers ? (
          <Notice tone="warn" title="当前不会实际发送">
            当前为{emailChannel.configured ? '本地记录模式' : '未完成配置的邮件通道'}，测试邮件不会送达收件箱。
          </Notice>
        ) : null}

        <FormField label="收件邮箱" hint="仅用于验证当前发件地址、访问凭据和邮件服务是否可用。">
          <TextField
            ariaLabel="测试邮件收件邮箱"
            type="email"
            className="w-[360px]"
            value={testEmail}
            maxLength={200}
            disabled={!writable || testingEmail}
            placeholder="you@example.com"
            onChange={setTestEmail}
          />
        </FormField>

        <div>
          <ActionButton
            variant="outline"
            size="sm"
            disabled={!writable || testingEmail || !testEmail.trim()}
            onClick={() => void doTestEmail()}
          >
            {testingEmail ? '发送中…' : '发送测试邮件'}
          </ActionButton>
        </div>

        {emailTestResult ? (
          <Notice
            tone={
              !emailTestResult.ok
                ? 'danger'
                : emailTestResult.delivered
                  ? 'success'
                  : 'warn'
            }
            title={
              emailTestResult.delivered
                ? '邮件服务商已受理测试邮件'
                : emailTestResult.error
                  ? '测试邮件发送失败'
                  : '测试邮件仅记录在本地'
            }
            className="mb-0"
          >
            投递通道：{deliveryProviderLabel(emailTestResult.provider)}
            {emailTestResult.messageId ? ` · 消息编号：${emailTestResult.messageId}` : ''}
            {emailTestResult.error ? ` · 原因：${emailErrorText(emailTestResult.error)}` : ''}
            {!emailTestResult.delivered && !emailTestResult.error
              ? ' · 当前通道不会实际发送邮件。'
              : ''}
          </Notice>
        ) : null}
      </div>
    </Panel>

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
            onChange={setTitle}
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
            onChange={setBody}
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
            onChange={setLink}
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
            onChange={setSendEmail}
          />
        </FormField>

        {sendEmail && emailChannel && (!emailChannel.enabled || !emailChannel.delivers) ? (
          <Notice tone="warn" className="mb-0">
            当前邮件通道未启用或不会实际发送。站内消息不受影响；邮件可能发送失败或不会发送。
          </Notice>
        ) : null}

        {/* 预览按用户实际看到的顺序排：标题在上、正文在下、可点击时整条可点 */}
        {broadcastReady && (
          <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <strong className="block text-foreground">{title}</strong>
            <p className="mt-1 whitespace-pre-wrap">{body}</p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <ActionButton
            variant="destructive"
            size="sm"
            disabled={!writable || !broadcastReady || sending}
            onClick={() => void doBroadcast()}
          >
            {sending ? '发送中…' : '发送广播'}
          </ActionButton>
          {sentResult && (
            <span className="text-[12px] text-muted-foreground">上次广播结果：{sentResult.users} 个活跃账号</span>
          )}
        </div>

        {sentResult ? (
          <dl className="grid grid-cols-4 divide-x divide-border rounded-lg border border-border bg-muted/20">
            <MiniStat label="站内消息" value={sentResult.sent} />
            <MiniStat
              label="邮件已提交"
              value={sentResult.emailSent}
              tone={sentResult.emailSent > 0 ? 'success' : 'muted'}
            />
            <MiniStat
              label="提交失败"
              value={sentResult.emailFailed}
              tone={sentResult.emailFailed > 0 ? 'danger' : 'muted'}
            />
            <MiniStat
              label="未发送"
              value={sentResult.emailSkipped}
              tone={sentResult.emailSkipped > 0 ? 'warn' : 'muted'}
            />
          </dl>
        ) : null}
      </div>
    </Panel>

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
        columns={columns}
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

    <FormDrawer
      open={formOpen}
      onClose={requestCloseForm}
      size="md"
      title={editing ? `编辑模板 ${editing.code}` : '新建消息模板'}
      busy={saving}
      dirty={formDirty}
      formError={formError}
      onSubmit={() => void saveTemplate()}
    >
      <FormField
        label="模板编码"
        hint={`编码与业务事件绑定，建好后不要改。可用编码：${BUILTIN_CODES.map((c) => c.code).join('、')}`}
      >
        <TextField
          ariaLabel="模板编码"
          className="w-[240px]"
          value={form.code}
          maxLength={60}
          disabled={!!editing}
          placeholder="如 task_failed"
          onChange={(value) => setForm((f) => ({ ...f, code: value }))}
        />
      </FormField>

      <FormField label="通道">
        <SelectField
          ariaLabel="通道"
          className="w-[200px]"
          value={form.channel}
          disabled={!!editing}
          onChange={(value) =>
            setForm((f) => ({ ...f, channel: (value ?? 'inapp') as MessageTemplateItem['channel'] }))
          }
          options={CHANNEL_OPTIONS}
        />
      </FormField>

      <FormField label="标题">
        <TextField
          ariaLabel="模板标题"
          value={form.subject}
          maxLength={120}
          onChange={(value) => setForm((f) => ({ ...f, subject: value }))}
        />
      </FormField>

      <FormField
        label="正文"
        hint={`变量占位：${BUILTIN_CODES.map((c) => `${c.code} → ${c.hint}`).join('；')}。未提供的变量原样保留，便于发现漏传。`}
      >
        <TextAreaField
          ariaLabel="模板正文"
          value={form.body}
          rows={6}
          maxLength={2000}
          onChange={(value) => setForm((f) => ({ ...f, body: value }))}
        />
      </FormField>

      <FormField
        label="启用"
        hint={
          form.enabled
            ? `启用中：${CHANNEL_LABEL[form.channel]}通知会优先使用本模板的文案。`
            : '已停用：系统将使用同通道可用模板或内置文案。'
        }
      >
        <SwitchField
          ariaLabel="启用"
          checked={form.enabled}
          onChange={(value) => setForm((f) => ({ ...f, enabled: value }))}
        />
      </FormField>
    </FormDrawer>
    </AdminPage>
  );
}
