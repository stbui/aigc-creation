import { useEffect, useMemo, useState } from 'react';

import {
  AdminPage,
  ConfirmDialog,
  EmptyState,
  ListError,
  PageSkeleton,
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
import { CategorySidebar } from './CategorySidebar';
import { TemplateWorkspace, type StatusFilter } from './TemplateWorkspace';
import { TemplatePreviewDialog } from './TemplatePreviewDialog';
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
 * 两栏工作台：
 *   左侧分类目录（一级分类 + 选中分类下的二级分类）
 *   右侧模板工作区（搜索 / 状态筛选 / 卡片网格 / 预览）
 *
 * 三级结构：一级分类（主题）→ 二级分类（来源文章 / 风格）→ 模板（图 + 提示词 + 标签）。
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<AdminTemplateItem | null>(null);

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

  const selectedCategory =
    categories.find((category) => category.id === categoryId) ?? null;
  const selectedGroup =
    selectedCategory?.groups.find((group) => group.id === groupId) ?? null;

  // 选中的分类/分组被删除后自动回落到上一级，避免右侧停留在不存在的实体上
  useEffect(() => {
    if (categoryId && !categories.some((category) => category.id === categoryId)) {
      setCategoryId(null);
      setGroupId(null);
    }
  }, [categories, categoryId]);

  useEffect(() => {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) {
      if (groupId) setGroupId(null);
      return;
    }
    if (groupId && !category.groups.some((group) => group.id === groupId)) {
      setGroupId(null);
    }
  }, [categories, categoryId, groupId]);

  const totalItems = useMemo(
    () =>
      categories.reduce(
        (sum, category) =>
          sum + category.groups.reduce((groupSum, group) => groupSum + group.itemCount, 0),
        0,
      ),
    [categories],
  );

  const groupNameById = useMemo(
    () =>
      new Map(
        categories.flatMap((category) =>
          category.groups.map((group) => [group.id, group.name] as const),
        ),
      ),
    [categories],
  );

  /** 模板编辑可能发生在「全部模板 / 一级分类」视图：此时 selectedGroup 为空，
   *  必须按条目自身的 groupId 找回所属分组，否则编辑抽屉会被条件渲染吞掉。 */
  const groupById = useMemo(
    () =>
      new Map(
        categories.flatMap((category) =>
          category.groups.map((group) => [group.id, group] as const),
        ),
      ),
    [categories],
  );

  const itemDrawerGroup = itemDrawer?.target
    ? (groupById.get(itemDrawer.target.groupId) ?? null)
    : selectedGroup;

  const formItems = useMemo(() => {
    if (selectedGroup) return selectedGroup.items;
    if (selectedCategory) return selectedCategory.groups.flatMap((group) => group.items);
    return categories.flatMap((category) =>
      category.groups.flatMap((group) => group.items),
    );
  }, [categories, selectedCategory, selectedGroup]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return formItems.filter((item) => {
      if (statusFilter === 'enabled' && !item.enabled) return false;
      if (statusFilter === 'disabled' && item.enabled) return false;
      if (tagFilter && !item.tags.includes(tagFilter)) return false;
      if (!keyword) return true;
      return [item.name, item.prompt, ...item.tags].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    });
  }, [formItems, search, statusFilter, tagFilter]);

  const panelTitle = selectedGroup
    ? `${selectedCategory?.name ?? ''} / ${selectedGroup.name}`
    : selectedCategory
      ? selectedCategory.name
      : '全部模板';

  const emptyText = useMemo(() => {
    if (search.trim() || statusFilter !== 'all' || tagFilter) {
      return { title: '没有匹配的模板', desc: '换一个关键词、清除标签筛选，或把状态筛选切回「全部」。' };
    }
    if (selectedGroup) {
      return { title: '该分组下还没有模板', desc: '点击右上角「新建模板」添加图片、提示词与标签。' };
    }
    if (selectedCategory) {
      return {
        title: '该分类下还没有模板',
        desc: '先在左侧创建二级分类，再在二级分类下新建模板。',
      };
    }
    return { title: '还没有模板分类', desc: '点击左侧「新建」开始搭建目录。' };
  }, [search, statusFilter, tagFilter, selectedCategory, selectedGroup]);

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
        await reload();
      } else {
        const created = await adminTemplateCatalogApi.createCategory(payload.value!);
        toast.success('一级分类已创建');
        await reload();
        setCategoryId(created.id);
        setGroupId(null);
      }
      setCategoryDrawer(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async (draft: typeof EMPTY_GROUP) => {
    const category = selectedCategory;
    if (!category) return;
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
        await reload();
      } else {
        const created = await adminTemplateCatalogApi.createGroup({
          categoryId: category.id,
          ...payload.value!,
        });
        toast.success('二级分类已创建');
        await reload();
        setCategoryId(category.id);
        setGroupId(created.id);
      }
      setGroupDrawer(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async (draft: typeof EMPTY_ITEM) => {
    const group = itemDrawerGroup;
    if (!group) {
      toast.error('模板所属分组不存在，请刷新后重试');
      return;
    }
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
          groupId: group.id,
          ...payload.value!,
        });
        toast.success('模板已创建');
      }
      await reload();
      setItemDrawer(null);
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
        if (categoryId === deleteTarget.id) {
          setCategoryId(null);
          setGroupId(null);
        }
      } else if (deleteTarget.kind === 'group') {
        await adminTemplateCatalogApi.removeGroup(deleteTarget.id);
        if (groupId === deleteTarget.id) setGroupId(null);
      } else {
        await adminTemplateCatalogApi.removeItem(deleteTarget.id);
        if (previewItem?.id === deleteTarget.id) setPreviewItem(null);
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
    <AdminPage
      title="写真模板"
      description="C 端 /template 的目录与素材。左侧选分类，右侧搜索、预览和维护模板。"
      actions={<RefreshButton onRefresh={() => void reload()} loading={loading} />}
    >

      <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-4">
        <CategorySidebar
          categories={categories}
          categoryId={categoryId}
          groupId={groupId}
          totalItems={totalItems}
          writable={writable}
          onSelectAll={() => {
            setCategoryId(null);
            setGroupId(null);
            setTagFilter(null);
          }}
          onSelectCategory={(nextCategoryId) => {
            setCategoryId(nextCategoryId);
            setGroupId(null);
            setTagFilter(null);
          }}
          onSelectGroup={(nextCategoryId, nextGroupId) => {
            setCategoryId(nextCategoryId);
            setGroupId(nextGroupId);
            setTagFilter(null);
          }}
          onCreateCategory={() => setCategoryDrawer({ mode: 'create' })}
          onEditCategory={(category) =>
            setCategoryDrawer({ mode: 'edit', target: category })
          }
          onDeleteCategory={requestDeleteCategory}
          onCreateGroup={() => setGroupDrawer({ mode: 'create' })}
          onEditGroup={(group) => setGroupDrawer({ mode: 'edit', target: group })}
          onDeleteGroup={requestDeleteGroup}
        />

        <TemplateWorkspace
          title={panelTitle}
          items={filteredItems}
          groupNameById={groupNameById}
          search={search}
          statusFilter={statusFilter}
          emptyTitle={emptyText.title}
          emptyDesc={emptyText.desc}
          writable={writable}
          canCreateGroup={Boolean(selectedCategory && !selectedGroup)}
          canCreateItem={Boolean(selectedGroup)}
          showGroupName={!selectedGroup}
          onSearchChange={setSearch}
          onStatusChange={setStatusFilter}
          tagFilter={tagFilter}
          onTagFilter={setTagFilter}
          onClearFilters={() => {
            setSearch('');
            setStatusFilter('all');
            setTagFilter(null);
          }}
          onCreateGroup={() => setGroupDrawer({ mode: 'create' })}
          onCreateItem={() => setItemDrawer({ mode: 'create' })}
          onPreview={setPreviewItem}
          onEdit={(item) => setItemDrawer({ mode: 'edit', target: item })}
          onDelete={requestDeleteItem}
        />
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
      {itemDrawer && itemDrawerGroup && (
        <ItemFormDrawer
          mode={itemDrawer.mode}
          groupName={itemDrawerGroup.name}
          initial={itemInitial}
          saving={saving}
          onClose={() => setItemDrawer(null)}
          onSubmit={(draft) => void saveItem(draft)}
        />
      )}

      <TemplatePreviewDialog item={previewItem} onClose={() => setPreviewItem(null)} />

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
    </AdminPage>
  );
}
