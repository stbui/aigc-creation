import { useEffect, useMemo, useState } from 'react';
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
 * 保存视图条的数据与交互逻辑。
 *
 * 内置视图 + 本机保存的视图。应用视图只调用页面传入的 `onApply`，由页面
 * 走各自已有的 `setQuery` / URL 同步；这里不发请求、不改权限。
 *
 * 展示层分两套：`primitives/saved-view-bar` 用共享语义组件，
 * `radar/SavedViewBar` 用 Radar 令牌；两边共用本 Hook，避免逻辑分叉。
 */
export function useSavedViewBar({
  pageKey,
  appliedFilters,
  draftFilters,
  onApply,
}: {
  pageKey: string;
  appliedFilters: AdminViewFilters;
  draftFilters?: AdminViewFilters;
  onApply: (filters: AdminViewFilters) => void;
}) {
  const { me } = useAdmin();
  const [views, setViews] = useState<AdminSavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    setViews(loadSavedViews(me?.id, pageKey));
  }, [me?.id, pageKey]);

  const builtins = ADMIN_BUILTIN_VIEWS[pageKey] ?? [];
  const currentKey = normalized(appliedFilters);
  const hasUnappliedChanges =
    draftFilters !== undefined && normalized(draftFilters) !== currentKey;

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
    if (hasUnappliedChanges) return;
    const next = createSavedView(name, appliedFilters);
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

  return {
    items,
    apply,
    hasUnappliedChanges,
    canSave: Boolean(me?.id) && !hasUnappliedChanges,
    saveOpen,
    openSave: () => setSaveOpen(true),
    closeSave: () => {
      setSaveOpen(false);
      setName('');
    },
    name,
    setName,
    save,
    remove,
  };
}
