import { ActionButton, ModalDialog } from '~/admin-ui/primitives';
import type { AdminTemplateItem } from '../../../types/api';

/**
 * 模板预览：大图 + 全部标签 + 完整提示词。
 */
export function TemplatePreviewDialog({
  item,
  onClose,
}: {
  item: AdminTemplateItem | null;
  onClose: () => void;
}) {
  return (
    <ModalDialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={item?.name ?? '模板预览'}
      description={item ? (item.enabled ? '启用' : '已停用') : undefined}
      size="xl"
      footer={
        <ActionButton variant="outline" onClick={onClose}>
          关闭
        </ActionButton>
      }
    >
      {item && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div className="flex items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            <img
              src={item.thumbFile}
              alt={`${item.name}大图`}
              className="max-h-[calc(100dvh-13rem)] w-full object-contain"
            />
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[12px] leading-5 text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div>
              <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">提示词</h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {item.prompt}
              </p>
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
