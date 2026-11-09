import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Plus, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { ActionButton, TextField } from './form';
import { ModalDialog } from './overlay';
import { useAdmin } from '../../context/AdminContext';
import {
  ADMIN_BUILTIN_VIEWS,
  createSavedView,
  loadSavedViews,
  persistSavedViews,
  resolveViewFilters,
  type AdminSavedView,
  type AdminViewFilters,
} from '../../lib/admin-saved-views';

function normalized(filters: AdminViewFilters): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, value]) => value !== undefined && value !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

/**
 * 保存视图条。
 *
 * 内置视图 + 本机保存的视图。应用视图只调用页面传入的 `onApply`，由页面
 * 走各自已有的 `setQuery` / URL 同步；组件本身不发请求、不改权限。
 */
export function SavedViewBar({
  pageKey,
  currentFilters,
  onApply,
  className,
}: {
  pageKey: string;
  currentFilters: AdminViewFilters;
  onApply: (filters: AdminViewFilters) => void;
  className?: string;
}) {
  const { me } = useAdmin();
  const [views, setViews] = useState<AdminSavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    setViews(loadSavedViews(me?.id, pageKey));
  }, [me?.id, pageKey]);

  const builtins = ADMIN_BUILTIN_VIEWS[pageKey] ?? [];
  const currentKey = normalized(currentFilters);

  const items = useMemo(
    () =>
      [...builtins, ...views].map((view) => ({
        view,
        active: normalized(resolveViewFilters(view.filters, me?.id)) === currentKey,
      })),
    [builtins, currentKey, me?.id, views],
  );

  const apply = (view: AdminSavedView) => {
    onApply(resolveViewFilters(view.filters, me?.id));
  };

  const save = () => {
    const next = createSavedView(name, currentFilters);
    if (!next.name) return;
    const merged = [...views, next];
    setViews(merged);
    persistSavedViews(me?.id, pageKey, merged);
    setSaveOpen(false);
    setName('');
  };

  const remove = (id: string) => {
    const merged = views.filter((view) => view.id !== id);
    setViews(merged);
    persistSavedViews(me?.id, pageKey, merged);
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="admin-saved-views">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Bookmark className="size-3.5" aria-hidden />
        视图
      </span>
      {items.map(({ view, active }) => (
        <span
          key={view.id}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
            active
              ? 'border-brand/30 bg-accent text-brand'
              : 'border-border bg-card text-muted-foreground hover:bg-muted',
          )}
        >
          <button type="button" className="outline-none" onClick={() => apply(view)}>
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
      <ActionButton
        variant="ghost"
        size="sm"
        icon={Plus}
        disabled={!me?.id}
        onClick={() => setSaveOpen(true)}
      >
        保存当前筛选
      </ActionButton>

      <ModalDialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setName('');
        }}
        title="保存当前筛选为视图"
        description="视图只保存在本机浏览器，不改变其他同事看到的内容。"
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <ActionButton variant="secondary" size="sm" onClick={() => setSaveOpen(false)}>
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
