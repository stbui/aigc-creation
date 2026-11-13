import { useMemo, useState } from 'react';
import { Pencil, RefreshCw, RotateCcw } from 'lucide-react';

import {
  ActionButton,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormDrawer,
  FormField,
  Notice,
  Panel,
  SkeletonPanel,
  StaleError,
  SwitchField,
  TextAreaField,
  TextField,
  ToneBadge,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { adminNotificationsApi } from '../../../lib/api';
import type { MessageTemplateItem } from '../../../types/api';
import { useAdminResource, useToast, useUnsavedGuard } from './hooks';
import {
  EMAIL_TEMPLATE_BY_CODE,
  EMAIL_TEMPLATE_GROUPS,
  EMAIL_TEMPLATES,
  renderEmailTemplatePreview,
  templatePlaceholder,
  type EmailTemplateMeta,
} from './template-constants';

interface TemplateDraft {
  subject: string;
  body: string;
  enabled: boolean;
}

function draftFrom(meta: EmailTemplateMeta, item?: MessageTemplateItem): TemplateDraft {
  return {
    subject: item?.subject || meta.defaultSubject,
    body: item?.body || meta.defaultBody,
    enabled: item?.enabled ?? true,
  };
}

function sameDraft(a: TemplateDraft | null, b: TemplateDraft | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 邮箱模板控制面。
 *
 * 只展示 `channel=email` 的记录，并按真实业务编码组织。模板停用或尚未创建时，
 * 发信链路继续使用备用文案，因此这里的开关控制的是“是否采用自定义内容”，
 * 不是“是否发送该类邮件”——后者由页面上的业务事件开关控制。
 */
export function EmailTemplatesPanel({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useAdminResource(
    () =>
      canManage ? adminNotificationsApi.templates() : Promise.resolve<MessageTemplateItem[]>([]),
    [canManage],
  );

  const templatesByCode = useMemo(
    () =>
      new Map(
        (data ?? [])
          .filter((item) => item.channel === 'email')
          .map((item) => [item.code, item]),
      ),
    [data],
  );

  const [openCode, setOpenCode] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateDraft | null>(null);
  const [formBase, setFormBase] = useState<TemplateDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingCode, setTogglingCode] = useState<string | null>(null);

  const editingMeta = openCode ? EMAIL_TEMPLATE_BY_CODE.get(openCode) ?? null : null;
  const dirty = Boolean(form && formBase && !sameDraft(form, formBase));
  useUnsavedGuard(dirty);

  const configuredCount = EMAIL_TEMPLATES.filter((meta) => templatesByCode.has(meta.code)).length;

  const templateFor = (code: string) => templatesByCode.get(code);

  const openEditor = (meta: EmailTemplateMeta) => {
    const item = templateFor(meta.code);
    const next = draftFrom(meta, item);
    setOpenCode(meta.code);
    setForm(next);
    setFormBase(next);
    setFormError(null);
  };

  const closeEditor = () => {
    setOpenCode(null);
    setForm(null);
    setFormBase(null);
    setFormError(null);
  };

  const restoreDefault = () => {
    if (!editingMeta) return;
    setForm((current) => ({
      ...(current ?? draftFrom(editingMeta)),
      subject: editingMeta.defaultSubject,
      body: editingMeta.defaultBody,
    }));
    setFormError(null);
  };

  const saveTemplate = async () => {
    if (!editingMeta || !form) return;
    const subject = form.subject.trim();
    const body = form.body.trim();
    if (!subject) {
      setFormError('请填写邮件主题，避免用户收到没有主题的通知。');
      return;
    }
    if (!body) {
      setFormError('请填写邮件正文，避免发送空白邮件。');
      return;
    }
    if (editingMeta.requiredVariable) {
      const required = templatePlaceholder(editingMeta, editingMeta.requiredVariable);
      if (!body.includes(required)) {
        setFormError(`该模板必须保留 ${required} 变量，否则用户无法完成邮件中的安全操作。`);
        return;
      }
    }

    setSaving(true);
    setFormError(null);
    try {
      await adminNotificationsApi.upsertTemplate({
        code: editingMeta.code,
        channel: 'email',
        subject,
        body,
        enabled: form.enabled,
      });
      toast.success(
        '邮件模板已保存',
        form.enabled
          ? '后续符合该业务事件的邮件将使用新模板发送。'
          : '后续邮件将使用备用文案，不会停止发送该类邮件。',
      );
      closeEditor();
      await reload({ silent: true });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '邮件模板保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  const toggleTemplate = async (meta: EmailTemplateMeta, enabled: boolean) => {
    const item = templateFor(meta.code);
    const base = draftFrom(meta, item);
    setTogglingCode(meta.code);
    try {
      await adminNotificationsApi.upsertTemplate({
        code: meta.code,
        channel: 'email',
        subject: base.subject.trim() || meta.defaultSubject,
        body: base.body,
        enabled,
      });
      toast.success(
        enabled ? '邮件模板已启用' : '邮件模板已停用',
        enabled
          ? '后续邮件将优先使用自定义模板内容。'
          : '后续邮件将使用备用文案，不会停止发送该类邮件。',
      );
      await reload({ silent: true });
    } catch (cause) {
      toast.error(
        '邮件模板状态更新失败',
        cause instanceof Error ? cause.message : '请稍后重试。',
      );
    } finally {
      setTogglingCode(null);
    }
  };

  return (
    <>
      <Panel
        title="邮件模板"
        note="按业务事件管理邮件主题、正文与模板状态。停用或尚未创建的模板会自动使用备用文案，不影响邮件发送链路。"
        extra={
          <div className="flex items-center gap-2">
            <ToneBadge tone={configuredCount > 0 ? 'brand' : 'neutral'}>
              已配置 {configuredCount} / {EMAIL_TEMPLATES.length}
            </ToneBadge>
            {canManage ? (
              <ActionButton
                variant="ghost"
                size="xs"
                icon={RefreshCw}
                disabled={loading}
                onClick={() => void reload()}
              >
                刷新模板
              </ActionButton>
            ) : null}
          </div>
        }
      >
        {!canManage ? (
          <Notice tone="locked" title="模板仅可查看" className="mb-0">
            当前账号没有消息模板管理权限。如需调整邮件主题、正文或启用状态，请联系具备“发送通知与维护模板”权限的管理员。
          </Notice>
        ) : loading && !data ? (
          <SkeletonPanel rows={6} className="mb-0" />
        ) : error && !data ? (
          <Notice tone="danger" title="邮件模板读取失败" className="mb-0">
            暂时无法确认当前模板配置。请刷新重试；在读取恢复前，请勿将页面中的默认文案视为线上实际模板。
            <ActionButton
              variant="ghost"
              size="xs"
              className="ml-2"
              onClick={() => void reload()}
            >
              重新加载
            </ActionButton>
          </Notice>
        ) : (
          <div className="flex flex-col gap-5">
            {error ? <StaleError error={error} onRetry={() => void reload()} /> : null}

            {EMAIL_TEMPLATE_GROUPS.map((group) => (
              <section key={group.key} aria-labelledby={`email-template-group-${group.key}`}>
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                  <h3
                    id={`email-template-group-${group.key}`}
                    className="m-0 text-[13px] font-semibold text-foreground"
                  >
                    {group.title}
                  </h3>
                  <p className="m-0 text-[12px] leading-5 text-muted-foreground">
                    {group.note}
                  </p>
                </div>

                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {group.templates.map((meta) => (
                    <TemplateCard
                      key={meta.code}
                      meta={meta}
                      item={templateFor(meta.code)}
                      saving={togglingCode === meta.code}
                      canManage={canManage}
                      onEdit={() => openEditor(meta)}
                      onToggle={(enabled) => void toggleTemplate(meta, enabled)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <FormDrawer
        open={Boolean(editingMeta)}
        onClose={closeEditor}
        size="lg"
        title={editingMeta ? `编辑邮件模板 · ${editingMeta.label}` : '编辑邮件模板'}
        description={editingMeta?.description}
        busy={saving}
        dirty={dirty}
        formError={formError}
        submitLabel="保存模板"
        submitDisabled={!form?.subject.trim() || !form?.body.trim()}
        onSubmit={() => void saveTemplate()}
        extraFooter={
          <ActionButton
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            disabled={saving}
            onClick={restoreDefault}
          >
            恢复内置文案
          </ActionButton>
        }
      >
        {editingMeta && form ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <ToneBadge tone="neutral">{editingMeta.code}</ToneBadge>
              <span className="text-[12px] text-muted-foreground">
                变量格式：
                <code className="ml-1 rounded bg-background px-1.5 py-0.5 font-mono text-foreground">
                  {templatePlaceholder(editingMeta, editingMeta.variables[0]?.key ?? 'value')}
                </code>
              </span>
              {editingMeta.requiredVariable ? (
                <span className="text-[12px] text-warn-text">
                  必须保留{' '}
                  <code className="font-mono">
                    {templatePlaceholder(editingMeta, editingMeta.requiredVariable)}
                  </code>
                </span>
              ) : null}
            </div>

            <FormField
              label="邮件主题"
              required
              hint="显示在用户收件箱的主题行，支持下方列出的模板变量。建议保持简短并包含关键业务信息。"
            >
              <TextField
                ariaLabel="邮件主题"
                value={form.subject}
                maxLength={120}
                showCount
                disabled={saving}
                placeholder={editingMeta.defaultSubject}
                onChange={(subject) =>
                  setForm((current) => (current ? { ...current, subject } : current))
                }
              />
            </FormField>

            <FormField
              label="邮件正文"
              required
              hint={`可用变量：${editingMeta.variables
                .map(
                  (variable) =>
                    `${templatePlaceholder(editingMeta, variable.key)}（${variable.label}）`,
                )
                .join('、')}。未提供的变量会原样保留，便于发现模板错误。`}
            >
              <TextAreaField
                ariaLabel="邮件正文"
                value={form.body}
                rows={10}
                maxLength={2000}
                showCount
                disabled={saving}
                onChange={(body) =>
                  setForm((current) => (current ? { ...current, body } : current))
                }
              />
            </FormField>

            <FormField
              label="启用自定义模板"
              hint={
                form.enabled
                  ? '后续符合该业务事件的邮件将优先使用此模板。'
                  : '停用后仍会发送该类邮件，但改用备用文案。此开关不会关闭业务邮件事件。'
              }
            >
              <SwitchField
                ariaLabel="启用自定义邮件模板"
                checked={form.enabled}
                disabled={saving}
                onChange={(enabled) =>
                  setForm((current) => (current ? { ...current, enabled } : current))
                }
              />
            </FormField>

            <TemplatePreview meta={editingMeta} subject={form.subject} body={form.body} />
          </>
        ) : null}
      </FormDrawer>
    </>
  );
}

function TemplateCard({
  meta,
  item,
  saving,
  canManage,
  onEdit,
  onToggle,
}: {
  meta: EmailTemplateMeta;
  item?: MessageTemplateItem;
  saving: boolean;
  canManage: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const Icon = meta.icon;
  const status = !item
    ? { label: '使用备用文案', tone: 'neutral' as const }
    : item.enabled
      ? { label: '自定义模板启用', tone: 'success' as const }
      : { label: '自定义模板停用', tone: 'warn' as const };
  const subject = item?.subject || meta.defaultSubject;
  const body = item?.body || meta.defaultBody;

  return (
    <Card
      data-testid={`email-template-${meta.code}`}
      className="min-w-0 gap-0 overflow-hidden rounded-xl border-border bg-card py-0 shadow-none"
    >
      <CardHeader className="gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              item?.enabled ? 'bg-brand/10 text-brand' : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-[13px]">{meta.label}</CardTitle>
              <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
            </div>
            <CardDescription className="mt-1 text-[12px] leading-5">
              {meta.description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 border-t border-border px-4 py-3">
        <div>
          <p className="m-0 text-xs font-medium text-muted-foreground">邮件主题</p>
          <p className="m-0 mt-0.5 truncate text-[13px] font-medium text-foreground" title={subject}>
            {subject}
          </p>
        </div>
        <div>
          <p className="m-0 text-xs font-medium text-muted-foreground">正文预览</p>
          <p className="m-0 mt-0.5 line-clamp-3 whitespace-pre-line text-[12px] leading-5 text-muted-foreground">
            {body}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="模板可用变量">
          {meta.variables.map((variable) => (
            <code
              key={variable.key}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              title={variable.label}
            >
              {templatePlaceholder(meta, variable.key)}
            </code>
          ))}
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2.5">
        <SwitchField
          ariaLabel={`启用${meta.label}邮件模板`}
          label="启用模板"
          checked={Boolean(item?.enabled)}
          disabled={!canManage || saving}
          onChange={onToggle}
        />
        <ActionButton
          variant="outline"
          size="sm"
          icon={Pencil}
          disabled={!canManage || saving}
          onClick={onEdit}
        >
          编辑
        </ActionButton>
      </CardFooter>
    </Card>
  );
}

function TemplatePreview({
  meta,
  subject,
  body,
}: {
  meta: EmailTemplateMeta;
  subject: string;
  body: string;
}) {
  return (
    <section aria-labelledby="email-template-preview-title" className="flex flex-col gap-2">
      <h3 id="email-template-preview-title" className="m-0 text-[13px] font-semibold text-foreground">
        示例预览
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <p className="m-0 text-xs text-muted-foreground">主题</p>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[13px] font-semibold text-foreground">
            {renderEmailTemplatePreview(meta, subject) || '未填写邮件主题'}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-6 text-foreground">
            {renderEmailTemplatePreview(meta, body) || '未填写邮件正文'}
          </p>
        </div>
      </div>
      <p className="m-0 text-[12px] leading-5 text-muted-foreground">
        预览使用示例数据，仅用于检查文案结构；实际发送时会替换为当前用户与业务数据。
      </p>
    </section>
  );
}
