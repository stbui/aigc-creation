import { useState, type ReactNode } from 'react';
import { Button } from '../../admin-ui/shadcn/kit';
import { adminLegalApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { ModalDialog } from '../../admin-ui/primitives/Dialog';
import { SelectBox, TextArea, TextInput } from '../../admin-ui/controls';
import {
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { FilterActions, FilterBar, PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
import type { AdminLegalDoc, LegalSlug, LegalStatus } from '../../types/api';

const SLUGS: { value: LegalSlug; label: string }[] = [
  { value: 'user-agreement', label: '用户协议' },
  { value: 'privacy-policy', label: '隐私政策' },
  { value: 'minors-policy', label: '未成年人保护' },
  { value: 'account-rules', label: '账号规则' },
];

const SLUG_LABEL: Record<string, string> = Object.fromEntries(SLUGS.map((s) => [s.value, s.label]));

/** draft/archived 在 StatusTag 的通用语义表里没有对应项, 显式给标签 */
const STATUS_LABEL: Record<LegalStatus, string> = {
  draft: '草稿',
  published: '生效中',
  archived: '已归档',
};

/**
 * 状态 → StatusTag 的色板键。
 * 通用映射表里没有法务三态，借用语义最近的键（等待/正常/注销）来取色，
 * 文案仍由 STATUS_LABEL 覆盖 —— 直接把 `draft` 传进去会渲染成灰色裸文本。
 */
const STATUS_TONE_KEY: Record<LegalStatus, string> = {
  draft: 'pending',
  published: 'active',
  archived: 'deleted',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

interface FormState {
  slug: LegalSlug;
  version: string;
  title: string;
  content: string;
}

/**
 * 法务文档（BoardUI）。
 *
 * 版本化的三条硬约束不能因为换界面而松动：
 *   1. 已发布的版本不可原地覆盖 —— 编辑只对草稿与归档版本开放；
 *   2. 保存只建草稿，发布走独立接口（它负责归档同文档的旧版本）；
 *   3. 发布是高危动作，必须填原因并写审计。
 *
 * 渲染层变化：读原文预览从 antd Modal 换成 `ModalDialog`，编辑表单从 antd
 * Drawer 换成 `Drawer` 原语（带固定操作区，长正文滚动时按钮不跑），未保存
 * 拦截与关闭确认沿用同一套 hook。
 */
export function AdminLegalPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('legal.write');

  const [slugFilter, setSlugFilter] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<AdminLegalDoc | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLegalDoc | null>(null);
  const [form, setForm] = useState<FormState>({ slug: 'user-agreement', version: '', title: '', content: '' });
  const [formBase, setFormBase] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<AdminLegalDoc | null>(null);
  // 发布属高危动作（全站法律文本立即变更），必须填写原因并写入审计
  const [publishReason, setPublishReason] = useState('');

  /*
   * 筛选条件是唯一的请求变量 —— 交给 useAdminResource 的依赖数组,
   * 换文档类别即自动重查, 不必手写一个只在 slugFilter 变化时重建的 useCallback。
   */
  const { data, loading, error, reload } = useAdminResource(
    () => adminLegalApi.versions(slugFilter),
    [slugFilter],
  );
  const rows = data ?? [];

  const formDirty = Boolean(
    formOpen && formBase && JSON.stringify(form) !== JSON.stringify(formBase),
  );
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
    if (!publishReason.trim()) {
      toast.warning('请填写发布原因（写入审计日志）');
      return;
    }
    setBusy(true);
    try {
      await adminLegalApi.publish(publishTarget.slug, publishTarget.version, publishReason.trim());
      toast.success(`版本 ${publishTarget.version} 已发布，同文档的旧版本已归档`);
      setPublishTarget(null);
      setPublishReason('');
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
      render: (row) => <code className="font-mono text-[11px] text-text-secondary">{row.version}</code>,
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
      render: (row) => (
        <StatusTag status={STATUS_TONE_KEY[row.status]} label={STATUS_LABEL[row.status]} />
      ),
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
          <Button variant="ghost" size="small" onClick={() => setPreview(row)}>
            查看
          </Button>
          {writable && row.status !== 'published' && (
            <Button variant="ghost" size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
          )}
          {writable && row.status !== 'published' && (
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setPublishReason('');
                setPublishTarget(row);
              }}
            >
              发布
            </Button>
          )}
          {writable && (
            <Button variant="ghost" size="small" onClick={() => openCreate(row)}>
              新版本
            </Button>
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
            <Button variant="primary" size="small" onClick={() => openCreate()}>
              新建版本
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <SelectBox
          className="w-48"
          ariaLabel="按文档筛选"
          placeholder="全部文档"
          allowClear
          value={slugFilter}
          onChange={setSlugFilter}
          options={SLUGS}
        />
        <FilterActions>
          <Button variant="secondary" size="small" onClick={() => void reload()}>
            刷新
          </Button>
        </FilterActions>
      </FilterBar>

      <Panel>
        {error && rows.length > 0 && (
          <AdminStaleError error={error} onRetry={() => void reload()} />
        )}
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
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={preview ? `${SLUG_LABEL[preview.slug] ?? preview.slug} · ${preview.version}` : ''}
        description={
          preview ? `${preview.title} · ${STATUS_LABEL[preview.status]} · 更新于 ${fmt(preview.updatedAt)}` : undefined
        }
      >
        {preview && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-text-primary">
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
            <Button variant="secondary" size="small" onClick={requestCloseForm}>
              取消
            </Button>
            <Button
              variant="primary"
              size="small"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? '保存中…' : '保存草稿'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">文档类型</label>
            <SelectBox
              ariaLabel="文档类型"
              className="w-56"
              value={form.slug}
              disabled={!!editing}
              onChange={(value) => setForm((f) => ({ ...f, slug: value as LegalSlug }))}
              options={SLUGS}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">版本号</label>
            <TextInput
              ariaLabel="版本号"
              className="w-56"
              value={form.version}
              disabled={!!editing}
              placeholder="如 v2 / 2026-11-01"
              maxLength={40}
              onChange={(value) => setForm((f) => ({ ...f, version: value }))}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              版本号一经使用即固定：已发布的版本不允许改正文，要改请用新版本号；同一 (文档, 版本) 的草稿可反复保存。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">标题</label>
            <TextInput
              ariaLabel="标题"
              value={form.title}
              maxLength={80}
              onChange={(value) => setForm((f) => ({ ...f, title: value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">正文</label>
            <TextArea
              ariaLabel="正文"
              value={form.content}
              rows={18}
              onChange={(value) => setForm((f) => ({ ...f, content: value }))}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              支持轻量 Markdown：<Code>## 标题</Code>、<Code>&gt; 提示</Code>、空行分段、
              <Code>**粗体**</Code>。前台按这四种形态渲染。
            </p>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
            >
              {formError}
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmAction
        open={!!publishTarget}
        title="发布该版本"
        description={
          publishTarget
            ? `发布后 ${SLUG_LABEL[publishTarget.slug] ?? publishTarget.slug} ${publishTarget.version} 将立即对全站生效，同文档的其他已发布版本自动归档。此操作会写入审计日志。`
            : ''
        }
        confirmText="发布"
        loading={busy}
        extra={
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lg-publish-reason" className="text-xs text-text-secondary">
              操作原因（必填，写入审计）
            </label>
            <TextArea
              ariaLabel="操作原因"
              rows={2}
              maxLength={200}
              value={publishReason}
              placeholder="如：V2 补充未成年人保护条款，法务 2026-10-21 定稿"
              onChange={setPublishReason}
            />
          </div>
        }
        onConfirm={() => void doPublish()}
        onCancel={() => setPublishTarget(null)}
      />
    </>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-background-secondary-default px-1 font-mono text-[11px]">{children}</code>;
}
