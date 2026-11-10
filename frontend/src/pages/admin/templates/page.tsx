import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import {
  ActionButton,
  ConfirmDialog,
  EmptyState,
  ListError,
  PageHeader,
  PageSkeleton,
  Panel,
  RefreshButton,
} from '~/admin-ui/primitives';
import { adminTemplateCatalogApi } from './api';
import { useAdmin, useAdminResource, useToast } from './hooks';
import {
  EMPTY_CATEGORY,
  EMPTY_GROUP,
  EMPTY_ITEM,
  toCategoryDraft,
  toGroupDraft,
  toItemDraft,
} from './constants';
import { buildCategoryPayload, buildGroupPayload, buildItemPayload } from './utils';
import { CategoryFormDrawer, GroupFormDrawer, ItemFormDrawer } from './forms';
import type {
  AdminTemplateCategory,
  AdminTemplateGroup,
  AdminTemplateItem,
} from '../../../types/api';

type DeleteTarget =
  | { kind: 'category'; id: string; name: string; impact: string[] }
  | { kind: 'group'; id: string; name: string; impact: string[] }
  | { kind: 'item'; id: string; name: string; impact: string[] };

/**
 * 写真模板管理（`/admin/templates`）。
 *
 * 三级结构：一级分类（来源文章 / 主题）→ 二级分类（风格 / 场景）→ 模板（图 + 提示词 + 标签）。
 * 左侧选一级分类，中间选二级分类，右侧维护该分组下的模板。
 * 一级/二级分类删除会级联删除下级内容，确认弹窗列出影响面；模板删除不可恢复。
 */
export function AdminTemplatesPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('template.write');

  const { data, loading, error, reload } = useAdminResource(() =>
    adminTemplateCatalogApi.catalog(),
  );
  const categories = data?.categories ?? [];

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (categories.length === 0) {
      setCategoryId(null);
      setGroupId(null);
      return;
    }
    if (!categories.some((category) => category.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const selectedCategory =
    categories.find((category) => category.id === categoryId) ?? null;

  useEffect(() => {
    if (!selectedCategory) {
      setGroupId(null);
      return;
    }
    if (!selectedCategory.groups.some((group) => group.id === groupId)) {
      setGroupId(selectedCategory.groups[0]?.id ?? null);
    }
  }, [selectedCategory, groupId]);

  const selectedGroup =
    selectedCategory?.groups.find((group) => group.id === groupId) ?? null;

  const [categoryDrawer, setCategoryDrawer] = useState<{
    mode: 'create' | 'edit';
    target?: AdminTemplateCategory;
  } | null>(null);
  const [groupDrawer, setGroupDrawer] = useState<{
    mode: 'create' | 'edit';
    target?: AdminTemplateGroup;
  } | null>(null);
  const [itemDrawer, setItemDrawer] = useState<{
    mode: 'create' | 'edit';
    target?: AdminTemplateItem;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const categoryInitial = useMemo(
    () => (categoryDrawer?.target ? toCategoryDraft(categoryDrawer.target) : EMPTY_CATEGORY),
    [categoryDrawer],
  );
  const groupInitial = useMemo(
    () => (groupDrawer?.target ? toGroupDraft(groupDrawer.target) : EMPTY_GROUP),
    [groupDrawer],
  );
  const itemInitial = useMemo(
    () => (itemDrawer?.target ? toItemDraft(itemDrawer.target) : EMPTY_ITEM),
    [itemDrawer],
  );

  const saveCategory = async (draft: typeof EMPTY_CATEGORY) => {
    const payload = buildCategoryPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error ?? '请检查表单');
      return;
    }
    setSaving(true);
    try {
      if (categoryDrawer?.target) {
        await adminTemplateCatalogApi.updateCategory(categoryDrawer.target.id, payload.value!);
        toast.success('一级分类已更新');
      } else {
        const created = await adminTemplateCatalogApi.createCategory(payload.value!);
        setCategoryId(created.id);
        toast.success('一级分类已创建');
      }
      setCategoryDrawer(null);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async (draft: typeof EMPTY_GROUP) => {
    if (!selectedCategory) return;
    const payload = buildGroupPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error ?? '请检查表单');
      return;
    }
    setSaving(true);
    try {
      if (groupDrawer?.target) {
        await adminTemplateCatalogApi.updateGroup(groupDrawer.target.id, payload.value!);
        toast.success('二级分类已更新');
      } else {
        const created = await adminTemplateCatalogApi.createGroup({
          categoryId: selectedCategory.id,
          ...payload.value!,
        });
        setGroupId(created.id);
        toast.success('二级分类已创建');
      }
      setGroupDrawer(null);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async (draft: typeof EMPTY_ITEM) => {
    if (!selectedGroup) return;
    const payload = buildItemPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error ?? '请检查表单');
      return;
    }
    setSaving(true);
    try {
      if (itemDrawer?.target) {
        await adminTemplateCatalogApi.updateItem(itemDrawer.target.id, payload.value!);
        toast.success('模板已更新');
      } else {
        await adminTemplateCatalogApi.createItem({
          groupId: selectedGroup.id,
          ...payload.value!,
        });
        toast.success('模板已创建');
      }
      setItemDrawer(null);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteCategory = (category: AdminTemplateCategory) => {
    const itemCount = category.groups.reduce((sum, group) => sum + group.itemCount, 0);
    setDeleteTarget({
      kind: 'category',
      id: category.id,
      name: category.name,
      impact: [
        `将删除 ${category.groups.length} 个二级分类`,
        `将删除 ${itemCount} 套模板（不可恢复）`,
      ],
    });
  };

  const requestDeleteGroup = (group: AdminTemplateGroup) => {
    setDeleteTarget({
      kind: 'group',
      id: group.id,
      name: group.name,
      impact: [`将删除该分组下的 ${group.itemCount} 套模板（不可恢复）`],
    });
  };

  const requestDeleteItem = (item: AdminTemplateItem) => {
    setDeleteTarget({
      kind: 'item',
      id: item.id,
      name: item.name,
      impact: ['删除后模板与提示词不可恢复；C 端将不再展示'],
    });
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.kind === 'category') {
        await adminTemplateCatalogApi.removeCategory(deleteTarget.id);
      } else if (deleteTarget.kind === 'group') {
        await adminTemplateCatalogApi.removeGroup(deleteTarget.id);
      } else {
        await adminTemplateCatalogApi.removeItem(deleteTarget.id);
      }
      toast.success(`已删除「${deleteTarget.name}」`);
      setDeleteTarget(null);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <PageSkeleton
        title="写真模板"
        description="维护 C 端 /template 的模板目录：一级分类、二级分类与模板条目。"
        cards={6}
      />
    );
  }
  if (error && !data) {
    return <ListError error={error} onRetry={() => void reload()} />;
  }
  if (!data) return <EmptyState title="还没有模板目录" />;

  return (
    <div>
      <PageHeader
        title="写真模板"
        description="维护 C 端 /template 的模板目录：一级分类（来源文章）→ 二级分类（风格/场景）→ 模板（图片 + 提示词 + 标签）。"
        actions={<RefreshButton onRefresh={() => void reload()} loading={loading} />}
      />

      <div className="grid grid-cols-[minmax(220px,260px)_minmax(220px,280px)_minmax(0,1fr)] items-start gap-4">
        <Panel
          title="一级分类"
          note={`${categories.length} 个`}
          extra={
            writable && (
              <ActionButton
                size="xs"
                icon={Plus}
                onClick={() => setCategoryDrawer({ mode: 'create' })}
              >
                新建
              </ActionButton>
            )
          }
        >
          {categories.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              还没有一级分类，点击「新建」开始。
            </p>
          ) : (
            <div className="divide-y divide-border">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className={`flex items-start gap-2 px-3 py-3 ${
                    category.id === categoryId ? 'bg-muted/50' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setCategoryId(category.id);
                      setGroupId(null);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-[13px] text-foreground">
                        {category.name}
                      </strong>
                      {!category.enabled && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[12px] text-muted-foreground">
                          停用
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {category.slug} · {category.groups.length} 个分组
                    </div>
                  </button>
                  {writable && (
                    <div className="flex shrink-0 items-center gap-1">
                      <ActionButton
                        variant="ghost"
                        size="xs"
                        icon={Pencil}
                        ariaLabel={`编辑分类${category.name}`}
                        onClick={() => setCategoryDrawer({ mode: 'edit', target: category })}
                      />
                      <ActionButton
                        variant="ghost"
                        size="xs"
                        icon={Trash2}
                        ariaLabel={`删除分类${category.name}`}
                        onClick={() => requestDeleteCategory(category)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="二级分类"
          note={selectedCategory ? selectedCategory.name : '未选择'}
          extra={
            selectedCategory &&
            writable && (
              <ActionButton
                size="xs"
                icon={Plus}
                onClick={() => setGroupDrawer({ mode: 'create' })}
              >
                新建
              </ActionButton>
            )
          }
        >
          {!selectedCategory ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              先在左侧选择一级分类。
            </p>
          ) : selectedCategory.groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              该分类下还没有二级分类。
            </p>
          ) : (
            <div className="divide-y divide-border">
              {selectedCategory.groups.map((group) => (
                <div
                  key={group.id}
                  className={`flex items-start gap-2 px-3 py-3 ${
                    group.id === groupId ? 'bg-muted/50' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setGroupId(group.id)}
                  >
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-[13px] text-foreground">
                        {group.name}
                      </strong>
                      {!group.enabled && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[12px] text-muted-foreground">
                          停用
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {group.slug} · {group.itemCount} 套模板
                    </div>
                  </button>
                  {writable && (
                    <div className="flex shrink-0 items-center gap-1">
                      <ActionButton
                        variant="ghost"
                        size="xs"
                        icon={Pencil}
                        ariaLabel={`编辑分组${group.name}`}
                        onClick={() => setGroupDrawer({ mode: 'edit', target: group })}
                      />
                      <ActionButton
                        variant="ghost"
                        size="xs"
                        icon={Trash2}
                        ariaLabel={`删除分组${group.name}`}
                        onClick={() => requestDeleteGroup(group)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="模板"
          note={
            selectedGroup
              ? `${selectedGroup.name} · ${selectedGroup.itemCount} 套`
              : '未选择二级分类'
          }
          extra={
            selectedGroup &&
            writable && (
              <ActionButton
                size="xs"
                icon={Plus}
                onClick={() => setItemDrawer({ mode: 'create' })}
              >
                新建模板
              </ActionButton>
            )
          }
        >
          {!selectedGroup ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              先在左侧选择二级分类。
            </p>
          ) : selectedGroup.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              该分组下还没有模板。
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2">
              {selectedGroup.items.map((item) => (
                <article
                  key={item.id}
                  className="flex gap-3 rounded-lg border border-border bg-card p-2"
                >
                  <div className="h-[104px] w-[78px] shrink-0 overflow-hidden rounded-md bg-muted">
                    {item.thumbFile ? (
                      <img
                        src={item.thumbFile}
                        alt={`${item.name}预览`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                        无图
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start justify-between gap-1">
                      <strong className="truncate text-[13px] text-foreground">
                        {item.name}
                      </strong>
                      {!item.enabled && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[12px] text-muted-foreground">
                          停用
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {item.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-border bg-muted/60 px-1 text-[12px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="line-clamp-2 text-[12px] leading-4 text-muted-foreground">
                      {item.prompt}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap text-[12px] text-muted-foreground">
                        排序 {item.sortOrder}
                      </span>
                      {writable && (
                        <div className="flex items-center gap-1">
                          <ActionButton
                            variant="ghost"
                            size="xs"
                            icon={Pencil}
                            ariaLabel={`编辑模板${item.name}`}
                            onClick={() => setItemDrawer({ mode: 'edit', target: item })}
                          />
                          <ActionButton
                            variant="ghost"
                            size="xs"
                            icon={Trash2}
                            ariaLabel={`删除模板${item.name}`}
                            onClick={() => requestDeleteItem(item)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {categoryDrawer && (
        <CategoryFormDrawer
          mode={categoryDrawer.mode}
          initial={categoryInitial}
          saving={saving}
          onClose={() => setCategoryDrawer(null)}
          onSubmit={(draft) => void saveCategory(draft)}
        />
      )}
      {groupDrawer && selectedCategory && (
        <GroupFormDrawer
          mode={groupDrawer.mode}
          categoryName={selectedCategory.name}
          initial={groupInitial}
          saving={saving}
          onClose={() => setGroupDrawer(null)}
          onSubmit={(draft) => void saveGroup(draft)}
        />
      )}
      {itemDrawer && selectedGroup && (
        <ItemFormDrawer
          mode={itemDrawer.mode}
          groupName={selectedGroup.name}
          initial={itemInitial}
          saving={saving}
          onClose={() => setItemDrawer(null)}
          onSubmit={(draft) => void saveItem(draft)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `删除「${deleteTarget.name}」？` : '确认删除'}
        description="删除后不可恢复；C 端会立即不再展示相关内容。"
        impact={deleteTarget?.impact}
        danger
        confirmText="删除"
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
      />
    </div>
  );
}
