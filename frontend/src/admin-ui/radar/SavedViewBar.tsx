import { Bookmark, CircleAlert, Plus, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useSavedViewBar } from './saved-view-state';
import type { AdminViewFilters } from '../../lib/admin-saved-views';
import { ActionButton } from './action-bits';
import { TextField } from './forms';
import { ModalDialog } from './overlays';

/**
 * 保存视图条（Radar 视觉）。
 *
 * 与 `primitives/saved-view-bar` 共用 `useSavedViewBar` 的数据与交互逻辑，
 * 这里只负责展示：中性灰底、1px 细线、零阴影，选中视图用近黑动作色而不是
 * 品牌紫。
 */
export function SavedViewBar({
  pageKey,
  appliedFilters,
  draftFilters,
  onApply,
  onApplyDraft,
  className,
}: {
  pageKey: string;
  /** 已生效、正在决定列表结果的筛选；活动视图与保存都以它为准。 */
  appliedFilters: AdminViewFilters;
  /** 输入框中的草稿；仅用于提示“修改尚未查询”，不参与活动态或保存。 */
  draftFilters?: AdminViewFilters;
  onApply: (filters: AdminViewFilters) => void;
  onApplyDraft?: () => void;
  className?: string;
}) {
  const {
    items,
    apply,
    hasUnappliedChanges,
    canSave,
    saveOpen,
    openSave,
    closeSave,
    name,
    setName,
    save,
    remove,
  } = useSavedViewBar({ pageKey, appliedFilters, draftFilters, onApply });

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="admin-saved-views"
    >
      <span className="inline-flex items-center gap-1 text-[13px] text-radar-ink-500">
        <Bookmark className="size-3.5" aria-hidden />
        视图
      </span>
      {items.map(({ view, active }) => (
        <span
          key={view.id}
          className={cn(
            'inline-flex items-center gap-1 rounded-[8px] border px-2 py-1 text-[13px] transition-colors',
            active
              ? 'border-radar-ink-300 bg-radar-ink-100 text-radar-ink-950'
              : 'border-radar-ink-200 bg-radar-surface text-radar-ink-500 hover:bg-radar-surface-hover',
          )}
        >
          <button
            type="button"
            aria-pressed={active}
            className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent"
            onClick={() => apply(view)}
          >
            {view.name}
          </button>
          {!view.builtin && (
            <button
              type="button"
              aria-label={`删除视图 ${view.name}`}
              className="text-radar-ink-400 transition-colors hover:text-radar-alert focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent"
              onClick={() => remove(view.id)}
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {hasUnappliedChanges && (
        <span
          role="status"
          data-testid="admin-saved-view-draft"
          className="inline-flex items-center gap-1 rounded-[8px] border border-radar-code-border bg-radar-code-subtle px-2 py-1 text-[13px] text-radar-code"
        >
          <CircleAlert className="size-3.5" aria-hidden />
          筛选有未应用修改
          {onApplyDraft && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-radar-accent"
              onClick={onApplyDraft}
            >
              应用筛选
            </button>
          )}
        </span>
      )}
      <ActionButton variant="ghost" size="sm" icon={Plus} disabled={!canSave} onClick={openSave}>
        保存当前筛选
      </ActionButton>

      <ModalDialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (!open) closeSave();
        }}
        title="保存当前筛选为视图"
        description="只保存已应用的筛选；视图保存在本机浏览器，不改变其他同事看到的内容。"
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <ActionButton variant="secondary" size="sm" onClick={closeSave}>
              取消
            </ActionButton>
            <ActionButton variant="default" size="sm" disabled={!name.trim()} onClick={save}>
              保存
            </ActionButton>
          </div>
        }
      >
        <TextField
          ariaLabel="视图名称"
          value={name}
          onChange={setName}
          placeholder="例如：今天的退款单"
          maxLength={30}
        />
      </ModalDialog>
    </div>
  );
}
