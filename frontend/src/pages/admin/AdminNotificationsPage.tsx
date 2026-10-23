import { useEffect, useState } from 'react';
import { App, Button, Drawer, Input, Select, Switch, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminNotificationsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  adminMiniPagination,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
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

export function AdminNotificationsPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('message.write');

  /* ── 广播 ── */
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── 投递通道状态（只读） ── */
  const [channels, setChannels] = useState<DeliveryChannelStatusMap | null>(null);

  const { data, loading, error, reload } = useAdminResource(() => adminNotificationsApi.templates());
  const templates = data ?? [];

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
      message.success(`已向 ${res.users} 个活跃账号发送 ${res.sent} 条站内消息`);
      setTitle('');
      setBody('');
      setLink('');
      setConfirmOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const openCreate = (base?: MessageTemplateItem) => {
    setEditing(base ?? null);
    setForm(
      base
        ? { code: base.code, channel: base.channel, subject: base.subject ?? '', body: base.body, enabled: base.enabled }
        : { code: '', channel: 'inapp', subject: '', body: '', enabled: true },
    );
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
      message.success('模板已保存');
      setFormOpen(false);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<MessageTemplateItem> = [
    { title: '编码', dataIndex: 'code', width: 180 },
    {
      title: '通道',
      dataIndex: 'channel',
      width: 100,
      render: (v: string) => CHANNEL_LABEL[v] ?? v,
    },
    { title: '标题', dataIndex: 'subject', width: 180, render: (v: string | null) => v || '—' },
    { title: '正文', dataIndex: 'body', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (v: boolean) => <StatusTag status={v ? 'active' : 'disabled'} label={v ? '启用' : '停用'} />,
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (v: string) => fmt(v) },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_, row) =>
        writable ? (
          <div className="adm-row-actions">
            <Button size="small" type="link" onClick={() => openCreate(row)}>
              编辑
            </Button>
          </div>
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
            <Button type="primary" onClick={() => openCreate()}>
              新建模板
            </Button>
          ) : null
        }
      />

      {/*
        通道状态是只读事实，不是配置入口 —— 切换 / 填凭据只能改环境变量并重启。
        读不到时整块不渲染：宁可缺这一屏，也不能让「读失败」看起来像「通道正常」。
      */}
      {channels ? (
        <Panel title="投递通道" note="只读：来自服务启动时选中的实现，改配置需改环境变量并重启">
          <div className="adm-channel-status">
            {(
              [
                { label: '邮件', st: channels.email, target: channels.email.from },
                { label: '短信', st: channels.sms, target: channels.sms.sign },
              ] as const
            ).map(({ label, st, target }) => (
              <div key={label} className="adm-channel-status-item">
                <span className="adm-channel-status-name">{label}</span>
                <StatusTag
                  status={st.delivers ? 'active' : 'disabled'}
                  label={st.delivers ? `真实投递 · ${st.provider}` : `${st.provider} · 不真实投递`}
                />
                {target ? <span className="adm-channel-status-target">{target}</span> : null}
                {!st.configured ? (
                  <span className="adm-channel-status-warn">凭据不全，已回落控制台（日志有 WARN）</span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="全站广播" note="按当前活跃账号逐个写入，不可撤回">
        <div className="adm-msg-broadcast">
          <div className="adm-field">
            <label htmlFor="bc-title">标题</label>
            <Input
              id="bc-title"
              value={title}
              maxLength={80}
              showCount
              disabled={!writable}
              placeholder="如：双十一活动将于 11 月 1 日开启"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="bc-body">正文</label>
            <Input.TextArea
              id="bc-body"
              value={body}
              rows={4}
              maxLength={2000}
              showCount
              disabled={!writable}
              placeholder="写清楚时间、范围与用户要做什么"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="bc-link">跳转路径（可选）</label>
            <Input
              id="bc-link"
              value={link}
              maxLength={200}
              disabled={!writable}
              placeholder="站内相对路径，如 /packages"
              onChange={(e) => setLink(e.target.value)}
            />
            <div className="adm-field-hint">留空表示消息不可点击。只接受站内路径，外链请勿填写。</div>
          </div>

          {broadcastReady && (
            <div className="adm-msg-preview">
              <strong>{title}</strong>
              {body}
            </div>
          )}

          <div>
            <Button
              type="primary"
              danger
              disabled={!writable || !broadcastReady}
              onClick={() => setConfirmOpen(true)}
            >
              发送广播
            </Button>
          </div>

          {sentResult && (
            <div className="adm-field-hint">
              上次发送：{sentResult.users} 个账号，共 {sentResult.sent} 条。
            </div>
          )}
        </div>
      </Panel>

      <Panel title="消息模板" note="站内通知优先使用这里的文案；模板缺失或停用时回落到代码内置文案">
        {error && templates.length > 0 && (
          <AdminStaleError error={error} onRetry={() => void reload()} />
        )}
        {error && templates.length === 0 ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : loading && templates.length === 0 ? (
          <AdminListLoading />
        ) : templates.length === 0 ? (
          <AdminEmpty description="还没有模板，执行 npm run seed:messages 可灌入五条内置文案" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={templates}
            pagination={adminMiniPagination()}
          />
        )}
        <div className="adm-field-hint" style={{ marginTop: 12 }}>
          变量用 <code>{'{name}'}</code> 占位，仅替换通知调用方传入的字段。当前实际生效的编码：
          {BUILTIN_CODES.map((c) => ` ${c.code}`).join('、')}。本页模板只驱动站内消息（channel=inapp）；
          验证码与重置密码的邮件 / 短信走独立通道（console / http / aliyun，见环境变量），不读这些模板。
        </div>
      </Panel>

      <ConfirmAction
        open={confirmOpen}
        title="确认发送全站广播"
        description={`将向所有活跃账号写入这条站内消息，发送后无法撤回。标题：${title}`}
        danger
        confirmText="发送"
        loading={sending}
        onConfirm={() => void doBroadcast()}
        onCancel={() => setConfirmOpen(false)}
      />

      <Drawer
        open={formOpen}
        width={640}
        title={editing ? `编辑模板 ${editing.code}` : '新建消息模板'}
        onClose={() => setFormOpen(false)}
        destroyOnHidden
        extra={
          <div className="adm-row-actions">
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void saveTemplate()}>
              保存
            </Button>
          </div>
        }
      >
        <div className="adm-form">
          <div className="adm-field">
            <label htmlFor="tp-code">模板编码</label>
            <Input
              id="tp-code"
              value={form.code}
              maxLength={60}
              disabled={!!editing}
              placeholder="如 task_failed"
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
            <div className="adm-field-hint">
              编码与业务事件绑定，建好后不要改。可用编码：{BUILTIN_CODES.map((c) => c.code).join('、')}
            </div>
          </div>
          <div className="adm-field">
            <label htmlFor="tp-channel">通道</label>
            <Select
              id="tp-channel"
              value={form.channel}
              options={CHANNEL_OPTIONS}
              onChange={(v) => setForm((f) => ({ ...f, channel: v }))}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="tp-subject">标题</label>
            <Input
              id="tp-subject"
              value={form.subject}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            />
          </div>
          <div className="adm-field">
            <label htmlFor="tp-body">正文</label>
            <Input.TextArea
              id="tp-body"
              value={form.body}
              rows={6}
              maxLength={2000}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
            <div className="adm-field-hint">
              变量占位：{BUILTIN_CODES.map((c) => `${c.code} → ${c.hint}`).join('；')}。未提供的变量原样保留，便于发现漏传。
            </div>
          </div>
          <div className="adm-field">
            <label>启用</label>
            <Switch checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>
          {formError && <div className="adm-form-error">{formError}</div>}
        </div>
      </Drawer>
    </>
  );
}
