import { useEffect, useState } from 'react';
import { Button } from '../../admin-ui/shadcn/kit';
import { adminNotificationsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { Notice } from '../../admin-ui/primitives';
import { SelectBox, SwitchBox, TextArea, TextInput } from '../../admin-ui/controls';
import {
  AdminStaleError,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
import type { DeliveryChannelStatusMap, MessageTemplateItem } from '../../types/api';

const CHANNEL_LABEL: Record<string, string> = {
  inapp: '站内消息',
  email: '邮件',
  sms: '短信',
};

const CHANNEL_OPTIONS = Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }));

/** 站内消息实际读取的模板编码 —— 与通知服务内置兜底文案一一对应 */
const BUILTIN_CODES = [
  { code: 'payment_success', hint: '支付成功（订单号 / 金额 / 积分）' },
  { code: 'credit_granted', hint: '积分到账（积分）' },
  { code: 'task_failed', hint: '任务失败退款（能力 / 原因 / 积分）' },
  { code: 'membership_expired', hint: '会员到期（到期日）' },
  { code: 'ticket_reply', hint: '工单回复（工单号）' },
];

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 站内消息（BoardUI）。
 *
 * 三块互不相干的数据放在一页，但失败域必须彼此隔离：
 *   · 投递通道是**只读事实**，拉取失败就整块不渲染 —— 绝不能让「读失败」
 *     看起来像「通道正常」；
 *   · 广播按活跃账号逐条写入，不可撤回，因此按钮在缺少标题或正文时保持禁用；
 *   · 模板列表失败只影响模板区，不影响上面两块。
 *
 * 渲染层变化：antd Table → `AdminDataTable`（自带骨架 / 错误 / 空态），
 * antd Drawer → `Drawer` 原语（操作区固定，长正文不把按钮滚走），
 * antd Switch → `SwitchBox`（`isSelected` 与 `checked` 的命名差异收在控件层）。
 */
export function AdminNotificationsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('message.write');

  /* ── 广播 ── */
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);
  const [sentResult, setSentResult] = useState<{ sent: number; users: number } | null>(null);

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
  useEffect(() => {
    adminNotificationsApi
      .channels()
      .then(setChannels)
      .catch(() => setChannels(null));
  }, []);

  const doBroadcast = async () => {
    setSending(true);
    try {
      const res = await adminNotificationsApi.broadcast({
        title: title.trim(),
        body: body.trim(),
        ...(link.trim() ? { link: link.trim() } : {}),
      });
      setSentResult(res);
      toast.success(`已向 ${res.users} 个活跃账号发送 ${res.sent} 条站内消息`);
      setTitle('');
      setBody('');
      setLink('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
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
      render: (row) => <code className="font-mono text-[11px] text-text-primary">{row.code}</code>,
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
        <span className="block max-w-[420px] truncate text-text-secondary" title={row.body}>
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
    { key: 'updatedAt', title: '更新时间', width: 170, render: (row) => fmt(row.updatedAt) },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (row) =>
        writable ? (
          <Button variant="ghost" size="small" onClick={() => openCreate(row)}>
            编辑
          </Button>
        ) : null,
    },
  ];

  const broadcastReady = title.trim().length > 0 && body.trim().length > 0;

  return (
    <>
      <PageHeader
        title="站内消息"
        description="向全站活跃账号发送公告，或维护业务通知的文案模板。消息写入后用户可在顶栏铃铛查看。"
        actions={
          writable ? (
            <Button variant="primary" size="small" onClick={() => openCreate()}>
              新建模板
            </Button>
          ) : undefined
        }
      />

      {/*
        通道状态是只读事实，不是配置入口 —— 切换 / 填凭据只能改环境变量并重启。
        读不到时整块不渲染：宁可缺这一屏，也不能让「读失败」看起来像「通道正常」。
      */}
      {channels ? (
        <Panel title="投递通道" note="只读：来自服务启动时选中的实现，改配置需改环境变量并重启">
          <ul className="flex flex-col gap-2.5">
            {(
              [
                { label: '邮件', st: channels.email, target: channels.email.from },
                { label: '短信', st: channels.sms, target: channels.sms.sign },
              ] as const
            ).map(({ label, st, target }) => (
              <li key={label} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-10 shrink-0 font-medium text-text-primary">{label}</span>
                <StatusTag
                  status={st.delivers ? 'active' : 'disabled'}
                  label={st.delivers ? `真实投递 · ${st.provider}` : `${st.provider} · 不真实投递`}
                />
                {target ? (
                  <span className="font-mono text-[11px] text-text-tertiary">{target}</span>
                ) : null}
                {!st.configured ? (
                  <span className="text-status-yellow-text">凭据不全，已回落控制台（日志有 WARN）</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="全站广播" note="按当前活跃账号逐个写入，不可撤回">
        <div className="flex max-w-[760px] flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              标题
            </label>
            <TextInput
              ariaLabel="广播标题"
              value={title}
              maxLength={80}
              showCount
              disabled={!writable}
              placeholder="如：双十一活动将于 11 月 1 日开启"
              onChange={setTitle}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              正文
            </label>
            <TextArea
              ariaLabel="广播正文"
              value={body}
              rows={4}
              maxLength={2000}
              showCount
              disabled={!writable}
              placeholder="写清楚时间、范围与用户要做什么"
              onChange={setBody}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">
              跳转路径（可选）
            </label>
            <TextInput
              ariaLabel="跳转路径"
              className="w-[320px]"
              value={link}
              maxLength={200}
              disabled={!writable}
              placeholder="站内相对路径，如 /packages"
              onChange={setLink}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              留空表示消息不可点击。只接受站内路径，外链请勿填写。
            </p>
          </div>

          {/* 预览按用户实际看到的顺序排：标题在上、正文在下、可点击时整条可点 */}
          {broadcastReady && (
            <div className="rounded-lg border border-border-table bg-background-secondary-default px-3 py-2.5 text-xs leading-5 text-text-secondary">
              <strong className="block text-text-primary">{title}</strong>
              <p className="mt-1 whitespace-pre-wrap">{body}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="small"
              disabled={!writable || !broadcastReady || sending}
              onClick={() => void doBroadcast()}
            >
              {sending ? '发送中…' : '发送广播'}
            </Button>
            {sentResult && (
              <span className="text-[11px] text-text-tertiary">
                上次发送：{sentResult.users} 个账号，共 {sentResult.sent} 条。
              </span>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="消息模板" note="站内通知优先使用这里的文案；模板缺失或停用时回落到代码内置文案">
        {error && templates.length > 0 && (
          <AdminStaleError error={error} onRetry={() => void reload()} />
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
          emptyText="还没有模板，执行 npm run seed:messages 可灌入五条内置文案"
        />
        <p className="mt-3 text-[11px] leading-4 text-text-tertiary">
          变量用 <code className="font-mono">{'{name}'}</code> 占位，仅替换通知调用方传入的字段。当前实际生效的编码：
          {BUILTIN_CODES.map((c) => ` ${c.code}`).join('、')}。本页模板只驱动站内消息（channel=inapp）；
          验证码与重置密码的邮件 / 短信走独立通道（console / http / aliyun，见环境变量），不读这些模板。
        </p>
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={640}
        title={editing ? `编辑模板 ${editing.code}` : '新建消息模板'}
        description={formDirty ? '有未保存修改' : undefined}
        footer={
          <>
            <Button variant="secondary" size="small" onClick={requestCloseForm}>
              取消
            </Button>
            <Button variant="primary" size="small" disabled={saving} onClick={() => void saveTemplate()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">模板编码</label>
            <TextInput
              ariaLabel="模板编码"
              className="w-[240px]"
              value={form.code}
              maxLength={60}
              disabled={!!editing}
              placeholder="如 task_failed"
              onChange={(value) => setForm((f) => ({ ...f, code: value }))}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              编码与业务事件绑定，建好后不要改。可用编码：{BUILTIN_CODES.map((c) => c.code).join('、')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">通道</label>
            <SelectBox
              ariaLabel="通道"
              className="w-[200px]"
              value={form.channel}
              onChange={(value) =>
                setForm((f) => ({ ...f, channel: (value ?? 'inapp') as MessageTemplateItem['channel'] }))
              }
              options={CHANNEL_OPTIONS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">标题</label>
            <TextInput
              ariaLabel="模板标题"
              value={form.subject}
              maxLength={120}
              onChange={(value) => setForm((f) => ({ ...f, subject: value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">正文</label>
            <TextArea
              ariaLabel="模板正文"
              value={form.body}
              rows={6}
              maxLength={2000}
              onChange={(value) => setForm((f) => ({ ...f, body: value }))}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              变量占位：{BUILTIN_CODES.map((c) => `${c.code} → ${c.hint}`).join('；')}。
              未提供的变量原样保留，便于发现漏传。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">启用</label>
            <SwitchBox
              checked={form.enabled}
              onChange={(value) => setForm((f) => ({ ...f, enabled: value }))}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              {form.enabled ? '启用中：站内通知会使用本模板的文案。' : '已停用：回落到代码内置文案。'}
            </p>
          </div>

          {formError && (
            <Notice tone="danger">
              {formError}
            </Notice>
          )}
        </div>
      </Drawer>
    </>
  );
}
