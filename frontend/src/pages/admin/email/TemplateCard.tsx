import { Pencil } from 'lucide-react';

import {
  ActionButton,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  SwitchField,
  ToneBadge,
} from './components';
import type { EmailTemplateMeta, MessageTemplateItem } from './types';
import { cn, templatePlaceholder } from './utils';

/**
 * 单张邮件模板卡片：状态、当前主题与正文预览、变量清单、启用开关。
 *
 * 停用不等于停发 —— 卡片文案必须写清「改用备用文案」，否则运营会以为
 * 关掉开关就不再发这类邮件。
 */
export function TemplateCard({
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
              item?.enabled ? 'bg-radar-ink-100 text-radar-ink-950' : 'bg-muted text-muted-foreground',
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
