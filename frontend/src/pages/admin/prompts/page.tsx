import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';

import { adminPromptsApi } from './api';
import {
  ActionButton,
  AdminPage,
  ConfirmDialog,
  Notice,
  Panel,
  RefreshButton,
  StaleError,
  type AppliedFilter,
} from './components';
import {
  useAdmin,
  useAdminList,
  useAdminUrlFilterSync,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { DEFAULT_SORT, EMPTY_PROMPT_DRAFT, MODALITY_LABEL, type PromptDraft } from './constants';
import { buildPromptPayload, modalityLabel, parseSort, promptHeading, toDraft } from './utils';
import { PromptFilterBar } from './PromptFilterBar';
import { PromptFormDrawer } from './PromptFormDrawer';
import { PromptTable } from './PromptTable';
import type { AdminPrompt, AdminPromptListResult } from './types';

/**
 * 提示词管理（`/admin/prompts`）。
 *
 * 可复用的提示词资产库：标题 / 分类 / 模态 / 正文 / 反向提示词 / 标签。
 * C 端页面暂未接入，本页是唯一入口；删除为物理删除，没有引用保护。
 *
 * ## 模块划分
 *
 * 筛选条 / 列表 / 表单抽屉各自独立；本文件只保留取数、筛选状态与写操作编排。
 */
export function AdminPromptsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const readable = can('prompt.read');
  const writable = can('prompt.write');

  // 深链/刷新后保留筛选；初始值同时喂给 useAdminList，首次请求即带筛选。
  const [searchParams] = useSearchParams();
  const initialKeyword = searchParams.get('keyword') ?? '';
  const initialCategory = searchParams.get('category') || undefined;
  const rawModality = searchParams.get('modality');
  const initialModality = rawModality && rawModality in MODALITY_LABEL ? rawModality : undefined;
  const rawEnabled = searchParams.get('enabled');
  const initialEnabled = rawEnabled === 'true' || rawEnabled === 'false' ? rawEnabled : undefined;
  const initialSort = parseSort(searchParams.get('sort'));

  const [keyword, setKeyword] = useState(initialKeyword);
  const [category, setCategory] = useState<string | undefined>(initialCategory);
  const [modality, setModality] = useState<string | undefined>(initialModality);
  const [enabled, setEnabled] = useState<string | undefined>(initialEnabled);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPrompt | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [draftBase, setDraftBase] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AdminPrompt | null>(null);

  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminPromptsApi.list({
        page: params.page as number,
        pageSize: params.pageSize as number,
        keyword: params.keyword as string | undefined,
        category: params.category as string | undefined,
        modality: params.modality as string | undefined,
        enabled: params.enabled as boolean | undefined,
        // 取消排序时 AdminDataTable 给 null；不能让它变成 `sort=null` 发出去
        sort: typeof params.sort === 'string' ? params.sort : undefined,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } =
    useAdminList<AdminPromptListResult>(fetcher, {
      keyword: initialKeyword || undefined,
      category: initialCategory,
      modality: initialModality,
      enabled: initialEnabled === undefined ? undefined : initialEnabled === 'true',
      sort: initialSort,
    });

  const appliedSort = parseSort(typeof params.sort === 'string' ? params.sort : null);

  // 只同步已生效的筛选，不同步分页
  useAdminUrlFilterSync({
    keyword: params.keyword as string | undefined,
    category: params.category as string | undefined,
    modality: params.modality as string | undefined,
    enabled: params.enabled as boolean | undefined,
    // 排序不是筛选：不进 hasFilter，但刷新后要能保住；默认值不写 URL
    sort: appliedSort === DEFAULT_SORT ? undefined : appliedSort,
  });

  const hasFilter = Boolean(
    params.keyword || params.category || params.modality || params.enabled !== undefined,
  );
  const rows = data?.items ?? [];
  const categories = data?.categories ?? [];

  const applyFilters = () =>
    setQuery({
      keyword: keyword.trim() || undefined,
      category,
      modality,
      enabled: enabled === undefined ? undefined : enabled === 'true',
    });

  const resetFilters = () => {
    setKeyword('');
    setCategory(undefined);
    setModality(undefined);
    setEnabled(undefined);
    setQuery({
      keyword: undefined,
      category: undefined,
      modality: undefined,
      enabled: undefined,
      // 与用户列表一致：清除筛选时排序一并回到默认，避免「清空后还是上次的顺序」
      sort: DEFAULT_SORT,
    });
  };

  const appliedKeyword = (params.keyword as string | undefined) ?? '';
  const appliedCategory = params.category as string | undefined;
  const appliedModality = params.modality as string | undefined;
  const appliedEnabled = params.enabled as boolean | undefined;
  const appliedChips: AppliedFilter[] = [
    appliedKeyword
      ? {
          key: 'keyword',
          label: `关键词：${appliedKeyword}`,
          onClear: () => {
            setKeyword('');
            setQuery({ keyword: undefined });
          },
        }
      : null,
    appliedCategory
      ? {
          key: 'category',
          label: `分类：${appliedCategory}`,
          onClear: () => {
            setCategory(undefined);
            setQuery({ category: undefined });
          },
        }
      : null,
    appliedModality
      ? {
          key: 'modality',
          label: `模态：${modalityLabel(appliedModality)}`,
          onClear: () => {
            setModality(undefined);
            setQuery({ modality: undefined });
          },
        }
      : null,
    appliedEnabled !== undefined
      ? {
          key: 'enabled',
          label: `状态：${appliedEnabled ? '已启用' : '已停用'}`,
          onClear: () => {
            setEnabled(undefined);
            setQuery({ enabled: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const patchDraft = (patch: Partial<PromptDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_PROMPT_DRAFT);
    setDraftBase(EMPTY_PROMPT_DRAFT);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (row: AdminPrompt) => {
    const next = toDraft(row);
    setEditing(row);
    setDraft(next);
    setDraftBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    const payload = buildPromptPayload(draft);
    if (!payload.ok) {
      setFormError(payload.error);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await adminPromptsApi.update(editing.id, payload.body);
        toast.success('提示词已保存');
      } else {
        await adminPromptsApi.create(payload.body);
        toast.success('提示词已创建');
      }
      setFormOpen(false);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  /** 启停可随时再切回，按产品要求直接执行，不再弹窗确认 */
  const doToggle = async (row: AdminPrompt) => {
    setBusy(true);
    try {
      await adminPromptsApi.update(row.id, { enabled: !row.enabled });
      toast.success(row.enabled ? '已停用' : '已启用');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await adminPromptsApi.remove(deleting.id);
      toast.success(`已删除提示词「${promptHeading(deleting)}」`);
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  if (!readable) {
    return (
      <AdminPage title="提示词管理" description="可复用的提示词资产库。">
        <Panel title="提示词列表">
          <Notice tone="warn" className="mb-0">
            当前账号没有 prompt.read 权限，无法查看提示词库。如需访问，请联系管理员调整角色权限。
          </Notice>
        </Panel>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="提示词管理"
      description="可复用的提示词资产库；按分类、模态与标签归类，供后续 C 端与工具侧引用。"
      actions={
        <ActionButton
          variant="default"
          size="sm"
          icon={Plus}
          disabled={!writable}
          onClick={openCreate}
        >
          新建提示词
        </ActionButton>
      }
    >
      <PromptFilterBar
        keyword={keyword}
        onKeywordChange={setKeyword}
        category={category}
        onCategoryChange={setCategory}
        categories={categories}
        modality={modality}
        onModalityChange={setModality}
        enabled={enabled}
        onEnabledChange={setEnabled}
        appliedChips={appliedChips}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <Panel
        title="提示词列表"
        note="正文摘要用于快速辨认；完整内容在编辑抽屉中查看"
        extra={<RefreshButton loading={loading} onRefresh={reload} />}
      >
        {/* 刷新失败但手上还有上一次的数据：只挂提示，不把整个列表藏起来 */}
        {error && data && <StaleError error={error} onRetry={reload} />}

        <PromptTable
          rows={rows}
          loading={loading}
          error={rows.length === 0 ? error : null}
          onRetry={reload}
          writable={writable}
          busy={busy}
          onEdit={openEdit}
          onToggle={(row) => void doToggle(row)}
          onDelete={setDeleting}
          sort={appliedSort}
          onSortChange={(sort) => setQuery({ sort: sort ?? DEFAULT_SORT })}
          pagination={{
            current: data?.page ?? 1,
            pageSize: data?.pageSize ?? 20,
            total: data?.total ?? 0,
            unit: '条',
            onChange: setPage,
          }}
          emptyText={
            hasFilter
              ? '没有匹配的提示词。清除筛选条件后再试。'
              : '还没有提示词。新建第一条提示词，后续可在生成侧复用。'
          }
          emptyAction={
            hasFilter ? (
              <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                清除筛选
              </ActionButton>
            ) : writable ? (
              <ActionButton variant="default" size="sm" icon={Plus} onClick={openCreate}>
                创建第一条提示词
              </ActionButton>
            ) : undefined
          }
        />
      </Panel>

      <PromptFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        formError={formError}
        formDirty={formDirty}
        busy={busy}
        categories={categories}
        onPatch={patchDraft}
        onClose={() => setFormOpen(false)}
        onSave={() => void save()}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `删除提示词「${promptHeading(deleting)}」` : '删除提示词'}
        description="删除后无法恢复。当前 C 端尚未引用提示词，删除不会影响已有作品。"
        impact={['该提示词将从后台列表中移除', '正在编辑该提示词的其他后台会话将无法再保存']}
        danger
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AdminPage>
  );
}
