import type { EmailTemplateMeta } from './types';
import { renderEmailTemplatePreview } from './utils';

/** 编辑抽屉底部的示例预览：用示例数据把变量替换掉，只看结构是否成立。 */
export function TemplatePreview({
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
