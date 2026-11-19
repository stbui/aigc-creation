import { Bookmark, CircleAlert, Plus, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { ActionButton, TextField } from './form';
import { ModalDialog } from './overlay';
import { useSavedViewBar } from './saved-view-state';
import type { AdminViewFilters } from '../../lib/admin-saved-views';

/**
 * 保存视图条（共享语义版）。
 *
 * 内置视图 + 本机保存的视图。应用视图只调用页面传入的 `onApply`，由页面
 * 走各自已有的 `setQuery` / URL 同步；组件本身不发请求、不改权限。
 *
 * 页面实际使用的是 `radar/SavedViewBar`（同一套 `useSavedViewBar` 逻辑、
 * Radar 令牌视觉）。本文件供不在 `.radar-scope` 内的外壳级场景使用。
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
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="admin-saved-views">
      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
        <Bookmark className="size-3.5" aria-hidden />
        视图
      </span>
      {items.map(({ view, active }) => (
        <span
          key={view.id}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px] transition-colors',
            active
              ? 'border-border bg-accent text-foreground'
              : 'border-border bg-card text-muted-foreground hover:bg-muted',
          )}
        >
          <button
            type="button"
            aria-pressed={active}
            className="outline-none"
            onClick={() => apply(view)}
          >
            {view.name}
          </button>
          {!view.builtin && (
            <button
              type="button"
              aria-label={`删除视图 ${view.name}`}
              className="text-muted-foreground hover:text-danger-text"
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
          className="inline-flex items-center gap-1 rounded-md border border-warn-border bg-warn-soft px-2 py-1 text-[13px] text-warn-text"
        >
          <CircleAlert className="size-3.5" aria-hidden />
          筛选有未应用修改
          {onApplyDraft && (
            <button type="button" className="font-semibold underline underline-offset-2" onClick={onApplyDraft}>
              应用筛选
            </button>
          )}
        </span>
      )}
      <ActionButton
        variant="ghost"
        size="sm"
        icon={Plus}
        disabled={!canSave}
        onClick={openSave}
      >
        保存当前筛选
      </ActionButton>

      <ModalDialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (open) return;
          closeSave();
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
