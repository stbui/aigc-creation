import { useState } from 'react';
import { App, Button, Drawer, Input, Modal, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminLegalApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  adminMiniPagination,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, FilterActions, FilterBar, PageHeader, Panel, StatusTag } from '../../components/admin/PageHeader';
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

export function AdminLegalPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const writable = can('legal.write');

  const [slugFilter, setSlugFilter] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<AdminLegalDoc | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLegalDoc | null>(null);
  const [form, setForm] = useState<FormState>({ slug: 'user-agreement', version: '', title: '', content: '' });
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

  const openCreate = (base?: AdminLegalDoc) => {
    setEditing(null);
    setForm({
      slug: (base?.slug as LegalSlug) ?? (slugFilter as LegalSlug) ?? 'user-agreement',
      // 版本号不自动递增: 用户可能用日期或 v2.1, 猜一个反而让人改两遍
      version: '',
      title: base?.title ?? '',
      content: base?.content ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (doc: AdminLegalDoc) => {
    setEditing(doc);
    setForm({ slug: doc.slug as LegalSlug, version: doc.version, title: doc.title, content: doc.content });
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
      message.success('草稿已保存，确认无误后点「发布」生效');
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
      message.warning('请填写发布原因（写入审计日志）');
      return;
    }
    setBusy(true);
    try {
      await adminLegalApi.publish(publishTarget.slug, publishTarget.version, publishReason.trim());
      message.success(`版本 ${publishTarget.version} 已发布，同文档的旧版本已归档`);
      setPublishTarget(null);
      setPublishReason('');
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<AdminLegalDoc> = [
    {
      title: '文档',
      dataIndex: 'slug',
      width: 130,
      render: (v: string) => SLUG_LABEL[v] ?? v,
    },
    { title: '版本', dataIndex: 'version', width: 120 },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: LegalStatus) => <StatusTag status={STATUS_TONE_KEY[v]} label={STATUS_LABEL[v]} />,
    },
    { title: '发布时间', dataIndex: 'publishedAt', width: 170, render: (v: string | null) => fmt(v) },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (v: string | null) => fmt(v) },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, doc) => (
        <div className="adm-row-actions">
          <Button size="small" type="link" onClick={() => setPreview(doc)}>
            查看
          </Button>
          {writable && doc.status !== 'published' && (
            <Button size="small" type="link" onClick={() => openEdit(doc)}>
              编辑
            </Button>
          )}
          {writable && doc.status !== 'published' && (
            <Button
                size="small"
                type="link"
                onClick={() => {
                  setPublishReason('');
                  setPublishTarget(doc);
                }}
              >
              发布
            </Button>
          )}
          {writable && (
            <Button size="small" type="link" onClick={() => openCreate(doc)}>
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
            <Button type="primary" onClick={() => openCreate()}>
              新建版本
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <Select
          allowClear
          placeholder="全部文档"
          style={{ width: 200 }}
          value={slugFilter}
          onChange={(v) => setSlugFilter(v)}
          options={SLUGS}
        />
        <FilterActions>
          <Button onClick={() => void reload()}>刷新</Button>
        </FilterActions>
      </FilterBar>

      <Panel>
        {error && rows.length > 0 && (
          <AdminStaleError error={error} onRetry={() => void reload()} />
        )}
        {error && rows.length === 0 ? (
          <AdminListError error={error} onRetry={() => void reload()} />
        ) : loading && rows.length === 0 ? (
          <AdminListLoading />
        ) : rows.length === 0 ? (
          <AdminEmpty description="还没有法务文档，执行 npm run seed:legal 可灌入模板草稿（draft，需审阅后在此发布）" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={adminMiniPagination()}
            scroll={{ x: 900 }}
          />
        )}
      </Panel>

      {/* 只读预览: 用 pre 保留正文换行, 不渲染 Markdown —— 后台看的是原文 */}
      <Modal
        open={!!preview}
        title={preview ? `${SLUG_LABEL[preview.slug] ?? preview.slug} · ${preview.version}` : ''}
        onCancel={() => setPreview(null)}
        footer={null}
        width={720}
      >
        {preview && (
          <div className="adm-legal-preview">
            <div className="adm-legal-meta">
              {preview.title} · {STATUS_LABEL[preview.status]} · 更新于 {fmt(preview.updatedAt)}
            </div>
            <pre>{preview.content}</pre>
          </div>
        )}
      </Modal>

      <Drawer
        open={formOpen}
        size={720}
        title={editing ? `编辑 ${editing.version}（草稿）` : '新建法务文档版本'}
        onClose={() => setFormOpen(false)}
        destroyOnHidden
        extra={
          <div className="adm-row-actions">
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" loading={busy} onClick={() => void save()}>
              保存草稿
            </Button>
          </div>
        }
      >
        <div className="adm-form">
          <div className="adm-field">
            <label htmlFor="lg-slug">文档类型</label>
            <Select
              id="lg-slug"
              value={form.slug}
              disabled={!!editing}
              onChange={(v) => setForm((f) => ({ ...f, slug: v }))}
              options={SLUGS}
            />
          </div>

          <div className="adm-field">
            <label htmlFor="lg-version">版本号</label>
            <Input
              id="lg-version"
              value={form.version}
              disabled={!!editing}
              placeholder="如 v2 / 2026-11-01"
              maxLength={40}
              onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
            />
            <div className="adm-field-hint">
              版本号一经使用即固定：已发布的版本不允许改正文，要改请用新版本号；同一 (文档, 版本) 的草稿可反复保存。
            </div>
          </div>

          <div className="adm-field">
            <label htmlFor="lg-title">标题</label>
            <Input
              id="lg-title"
              value={form.title}
              maxLength={80}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="adm-field">
            <label htmlFor="lg-content">正文</label>
            <Input.TextArea
              id="lg-content"
              value={form.content}
              rows={18}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
            <div className="adm-field-hint">
              支持轻量 Markdown：<code>## 标题</code>、<code>&gt; 提示</code>、空行分段、<code>**粗体**</code>。前台按这四种形态渲染。
            </div>
          </div>

          {formError && <div className="adm-form-error">{formError}</div>}
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
          <div className="adm-field">
            <label htmlFor="lg-publish-reason">操作原因（必填，写入审计）</label>
            <Input.TextArea
              id="lg-publish-reason"
              rows={2}
              maxLength={200}
              value={publishReason}
              placeholder="如：V2 补充未成年人保护条款，法务 2026-10-21 定稿"
              onChange={(e) => setPublishReason(e.target.value)}
            />
          </div>
        }
        onConfirm={() => void doPublish()}
        onCancel={() => setPublishTarget(null)}
      />
    </>
  );
}
