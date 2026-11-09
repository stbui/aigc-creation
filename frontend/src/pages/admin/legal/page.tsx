import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SLUGS, SLUG_LABEL, STATUS_LABEL, STATUS_TONE_KEY } from './constants';
import { fmt } from './utils';
import {
  useAdminResource,
  useAdmin,
  useDiscardConfirm,
  useSearchParams,
  useUnsavedGuard,
  useToast,
} from './hooks';
import {
  ActionButton,
  RefreshButton,
  AdminDataTable,
  ConfirmDialog,
  Drawer,
  FilterActions,
  FilterBar,
  FormField,
  ModalDialog,
  PageHeader,
  Panel,
  SelectField,
  StatusTag,
  StaleError,
  TextAreaField,
  TextField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { adminLegalApi } from '../../../lib/api';

import type { AdminLegalDoc, LegalSlug } from '../../../types/api';

/** draft/archived 在 StatusTag 的通用语义表里没有对应项, 显式给标签 */

/**
 * 状态 → StatusTag 的色板键。
 * 通用映射表里没有法务三态，借用语义最近的键（等待/正常/注销）来取色，
 * 文案仍由 STATUS_LABEL 覆盖 —— 直接把 `draft` 传进去会渲染成灰色裸文本。
 */

interface FormState {
  slug: LegalSlug;
  version: string;
  title: string;
  content: string;
}

/**
 * 法务文档（后台）。
 *
 * 版本化的三条硬约束不能因为换界面而松动：
 *   1. 已发布的版本不可原地覆盖 —— 编辑只对草稿与归档版本开放；
 *   2. 保存只建草稿，发布走独立接口（它负责归档同文档的旧版本）；
 *   3. 发布是高危动作，系统自动记录操作上下文并写审计。
 *
 * 渲染层：读原文预览用 `ModalDialog`，编辑表单用 `Drawer` 原语（带固定操作区，
 * 长正文滚动时按钮不跑），未保存拦截与关闭确认沿用同一套 hook。
 */
export function AdminLegalPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('legal.write');

  const [searchParams, setSearchParams] = useSearchParams();
  /*
   * 文档类别与版本预览都走地址栏：从告警、审计或聊天里发来的
   * `/admin/legal?slug=privacy-policy&version=v2` 要能直接落到那一条。
   * 非法 slug 视为「全部文档」，不把地址栏当输入校验的唯一入口。
   */
  const slugParam = searchParams.get('slug');
  const slugFilter = SLUGS.some((item) => item.value === slugParam) ? slugParam! : undefined;
  const versionParam = searchParams.get('version');

  const setSlugFilter = useCallback(
    (next?: string) => {
      setSearchParams(
        () => {
          const params = new URLSearchParams(window.location.search);
          if (next) params.set('slug', next);
          else params.delete('slug');
          // 换类别后旧的版本预览必然不成立，一并清掉
          params.delete('version');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLegalDoc | null>(null);
  const [form, setForm] = useState<FormState>({ slug: 'user-agreement', version: '', title: '', content: '' });
  const [formBase, setFormBase] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<AdminLegalDoc | null>(null);

  /*
   * 筛选条件是唯一的请求变量 —— 交给 useAdminResource 的依赖数组,
   * 换文档类别即自动重查, 不必手写一个只在 slugFilter 变化时重建的 useCallback。
   */
  const { data, loading, error, reload } = useAdminResource(() => adminLegalApi.versions(slugFilter), [slugFilter]);
  const rows = data ?? [];

  /* 预览的那一版由 `?version=` 从当前列表里解析；行不存在（已删除 / 非法链接）就不弹 */
  const preview = useMemo(() => {
    if (!versionParam) return null;
    return (
      rows.find((row) => row.version === versionParam && (!slugFilter || row.slug === slugFilter)) ??
      null
    );
  }, [rows, versionParam, slugFilter]);

  const openPreview = (doc: AdminLegalDoc) => {
    setSearchParams(
      () => {
        const params = new URLSearchParams(window.location.search);
        params.set('slug', doc.slug);
        params.set('version', doc.version);
        return params;
      },
      { replace: true },
    );
  };

  const closePreview = (open: boolean) => {
    if (open) return;
    setSearchParams(
      () => {
        const params = new URLSearchParams(window.location.search);
        params.delete('version');
        return params;
      },
      { replace: true },
    );
  };

  const formDirty = Boolean(formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase));
  useUnsavedGuard(formDirty);
  const requestCloseForm = useDiscardConfirm(formDirty, () => setFormOpen(false));

  const openCreate = (base?: AdminLegalDoc) => {
    setEditing(null);
    const next = {
      slug: (base?.slug as LegalSlug) ?? (slugFilter as LegalSlug) ?? 'user-agreement',
      // 版本号不自动递增: 用户可能用日期或 v2.1, 猜一个反而让人改两遍
      version: '',
      title: base?.title ?? '',
      content: base?.content ?? '',
    };
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (doc: AdminLegalDoc) => {
    setEditing(doc);
    const next = {
      slug: doc.slug as LegalSlug,
      version: doc.version,
      title: doc.title,
      content: doc.content,
    };
    setForm(next);
    setFormBase(next);
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    const version = form.version.trim();
    const title = form.title.trim();
    const content = form.content.trim();
    if (!version) return setFormError('请填写版本号（如 v2 / 2026-11-01）');
    if (!title) return setFormError('请填写标题');
    if (!content) return setFormError('正文不能为空');

    setBusy(true);
    setFormError(null);
    try {
      // 只建草稿: 发布走独立接口, 由它负责把同 slug 的旧版本归档 ——
      // 若这里直接 upsert 成 published, 会出现「两个生效版本」的中间态。
      await adminLegalApi.upsert({ slug: form.slug, version, title, content, status: 'draft' });
      toast.success('草稿已保存，确认无误后点「发布」生效');
      setFormOpen(false);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const doPublish = async () => {
    if (!publishTarget) return;
    setBusy(true);
    try {
      await adminLegalApi.publish(publishTarget.slug, publishTarget.version);
      toast.success(`版本 ${publishTarget.version} 已发布，同文档的旧版本已归档`);
      setPublishTarget(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<AdminColumn<AdminLegalDoc>> = [
    {
      key: 'slug',
      title: '文档',
      width: 130,
      render: (row) => SLUG_LABEL[row.slug] ?? row.slug,
    },
    {
      key: 'version',
      title: '版本',
      width: 120,
      render: (row) => <code className="font-mono text-[12px] text-muted-foreground">{row.version}</code>,
    },
    {
      key: 'title',
      title: '标题',
      render: (row) => (
        <span className="block max-w-[420px] truncate" title={row.title}>
          {row.title}
        </span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 100,
      render: (row) => <StatusTag status={STATUS_TONE_KEY[row.status]} label={STATUS_LABEL[row.status]} />,
    },
    { key: 'publishedAt', title: '发布时间', width: 170, render: (row) => fmt(row.publishedAt) },
    { key: 'updatedAt', title: '更新时间', width: 170, render: (row) => fmt(row.updatedAt) },
    {
      key: 'actions',
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" onClick={() => openPreview(row)}>
            查看
          </ActionButton>
          {writable && row.status !== 'published' && (
            <ActionButton variant="ghost" size="sm" onClick={() => openEdit(row)}>
              编辑
            </ActionButton>
          )}
          {writable && row.status !== 'published' && (
            <ActionButton variant="ghost" size="sm" onClick={() => setPublishTarget(row)}>
              发布
            </ActionButton>
          )}
          {writable && (
            <ActionButton variant="ghost" size="sm" onClick={() => openCreate(row)}>
              新版本
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="法务文档"
        description="协议文本按版本管理：已发布的版本不可覆盖，修改须新建版本后发布；发布新版本时同文档的旧版本自动归档。"
        actions={
          writable ? (
            <ActionButton variant="default" size="sm" onClick={() => openCreate()}>
              新建版本
            </ActionButton>
          ) : undefined
        }
      />

      <FilterBar>
        <SelectField
          className="w-48"
          ariaLabel="按文档筛选"
          placeholder="全部文档"
          allowClear
          value={slugFilter}
          onChange={setSlugFilter}
          options={SLUGS}
        />
        <FilterActions>
          <RefreshButton onRefresh={reload} />
        </FilterActions>
      </FilterBar>

      <Panel>
        {error && rows.length > 0 && <StaleError error={error} onRetry={() => void reload()} />}
        {/*
         * 法务文档总量小（4 类 × 若干版本），后端一次全量返回，因此不做分页：
         * 分页器只会在「只有一页」时占掉一整行。
         */}
        <AdminDataTable<AdminLegalDoc>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          minWidth={900}
          emptyText="还没有法务文档，执行 npm run seed:legal 可灌入模板草稿（draft，需审阅后在此发布）"
        />
      </Panel>

      {/* 只读预览: 用 pre 保留正文换行, 不渲染 Markdown —— 后台看的是原文 */}
      <ModalDialog
        open={!!preview}
        onOpenChange={closePreview}
        title={preview ? `${SLUG_LABEL[preview.slug] ?? preview.slug} · ${preview.version}` : ''}
        description={
          preview ? `${preview.title} · ${STATUS_LABEL[preview.status]} · 更新于 ${fmt(preview.updatedAt)}` : undefined
        }
      >
        {preview && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground">
            {preview.content}
          </pre>
        )}
      </ModalDialog>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={720}
        title={editing ? `编辑 ${editing.version}（草稿）` : '新建法务文档版本'}
        description={formDirty ? '有未保存修改' : undefined}
        footer={
          <>
            <ActionButton variant="secondary" size="sm" onClick={requestCloseForm}>
              取消
            </ActionButton>
            <ActionButton variant="default" size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? '保存中…' : '保存草稿'}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField label="文档类型">
            <SelectField
              ariaLabel="文档类型"
              className="w-56"
              value={form.slug}
              disabled={!!editing}
              onChange={(value) => setForm((f) => ({ ...f, slug: value as LegalSlug }))}
              options={SLUGS}
            />
          </FormField>

          <FormField
            label="版本号"
            hint="版本号一经使用即固定：已发布的版本不允许改正文，要改请用新版本号；同一 (文档, 版本) 的草稿可反复保存。"
          >
            <TextField
              ariaLabel="版本号"
              className="w-56"
              value={form.version}
              disabled={!!editing}
              placeholder="如 v2 / 2026-11-01"
              maxLength={40}
              onChange={(value) => setForm((f) => ({ ...f, version: value }))}
            />
          </FormField>

          <FormField label="标题">
            <TextField
              ariaLabel="标题"
              value={form.title}
              maxLength={80}
              onChange={(value) => setForm((f) => ({ ...f, title: value }))}
            />
          </FormField>

          <FormField
            label="正文"
            hint={
              <>
                支持轻量 Markdown：<Code>## 标题</Code>、<Code>&gt; 提示</Code>、空行分段、
                <Code>**粗体**</Code>。前台按这四种形态渲染。
              </>
            }
          >
            <TextAreaField
              ariaLabel="正文"
              value={form.content}
              rows={18}
              onChange={(value) => setForm((f) => ({ ...f, content: value }))}
            />
          </FormField>

          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-danger-soft bg-danger-soft px-3 py-2 text-xs text-danger-text"
            >
              {formError}
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!publishTarget}
        title="发布该版本"
        description={
          publishTarget
            ? `发布后 ${SLUG_LABEL[publishTarget.slug] ?? publishTarget.slug} ${publishTarget.version} 将立即对全站生效，同文档的其他已发布版本自动归档。此操作会写入审计日志。`
            : ''
        }
        confirmText="发布"
        loading={busy}
        onConfirm={() => void doPublish()}
        onCancel={() => setPublishTarget(null)}
      />
    </>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-[12px]">{children}</code>;
}
