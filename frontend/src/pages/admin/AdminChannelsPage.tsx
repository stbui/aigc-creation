import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { adminChannelsApi, adminChannelModelsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { FilePick, NumberInput, SelectBox, SwitchBox, TextArea, TextInput } from '../../admin-ui/controls';
import { Drawer } from '../../admin-ui/primitives/Drawer';
import { useDiscardConfirm, useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminStaleError,
  ConfirmAction,
  useAdminDetailParam,
  useAdminList,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import {
  AppliedFilters,
  FilterActions,
  FilterBar,
  PageHeader,
  Panel,
  StatusTag,
  type AppliedFilter,
} from '../../components/admin/PageHeader';
import { ChannelModelsDrawer } from './channels/ChannelModelsDrawer';
import { ChannelModelHealthPanel } from './channels/ChannelModelHealthPanel';
import type { AdminChannelView, ChannelPageResult, SystemChannelExportView } from '../../types/model';

/**
 * 渠道工作台（`/admin/channels`）。
 *
 * 渠道是**供应侧**的唯一入口：Base URL、凭证、并发、出站代理都在这里配置，
 * 一条渠道可以挂任意模态的模型。与 C 端「前台模型」分开，是为了让运营能
 * 只换供应、不改产品：前台模型的 revision 指向线路，线路再指向渠道模型。
 *
 * 四条不能省的行为：
 *   1. 凭证只写不读 —— 后台投影永不回显 API Key，只显示「已配置」；
 *   2. 删除是软删除（账单 / 调用记录 / 审计仍引用渠道 id），凭证立即清空；
 *   3. 新建渠道默认启用，但模型导入一律默认停用：没有价格档的模型进路由
 *      只会让用户收到「无可用线路」；
 *   4. 保存任何渠道写入都让目录快照失效，C 端下一次请求即生效。
 */

interface ChannelDraft {
  name: string;
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  proxyUrl: string;
  useGlobalConcurrency: boolean;
  concurrencyLimit: string;
  enabled: boolean;
  sortOrder: string;
  headers: string;
  reason: string;
}

const EMPTY_DRAFT: ChannelDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  secretKey: '',
  proxyUrl: '',
  useGlobalConcurrency: true,
  concurrencyLimit: '8',
  enabled: true,
  sortOrder: '0',
  headers: '',
  reason: '',
};

function toDraft(channel: AdminChannelView): ChannelDraft {
  return {
    name: channel.name,
    baseUrl: channel.baseUrl,
    apiKey: '',
    secretKey: '',
    proxyUrl: channel.proxyUrl,
    // 并发 0 表示跟随全局上限
    useGlobalConcurrency: channel.concurrencyLimit === 0,
    concurrencyLimit: String(channel.concurrencyLimit || 8),
    enabled: channel.enabled,
    sortOrder: String(channel.sortOrder ?? 0),
    headers: channel.headers && channel.headers.length > 0 ? JSON.stringify(channel.headers, null, 2) : '',
    reason: '',
  };
}

/** 表单字段容器 */
function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <p className="text-[11px] leading-4 text-text-tertiary">{hint}</p>}
    </div>
  );
}

/** 导出文件下载：走 Blob，不经 `downloadCsv`（不是 CSV，且要保留 JSON 结构） */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdminChannelsPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('channel.write');

  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);

  const fetcher = useCallback(
    (params: Record<string, unknown>) =>
      adminChannelsApi.list({
        keyword: params.keyword as string | undefined,
        status: params.status as string | undefined,
        page: params.page as number,
        limit: params.pageSize as number,
      }),
    [],
  );

  const { data, loading, error, params, setQuery, setPage, reload } = useAdminList<ChannelPageResult>(fetcher);

  const [editing, setEditing] = useState<AdminChannelView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ChannelDraft>(EMPTY_DRAFT);
  const [draftBase, setDraftBase] = useState<ChannelDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminChannelView | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [modelsFor, setModelsFor] = useModelsDrawerParam();

  const rows = data?.channels ?? [];
  const total = data?.total ?? 0;

  /*
   * 线路健康指标与渠道列表是两份数据：列表按页取，健康按线路全量取
   * （运营要看的是「哪条线在坏」，不是「当前页里的哪条线在坏」）。
   */
  const health = useAdminResource(() => adminChannelModelsApi.health());
  const healthRows = health.data?.items ?? [];

  const appliedKeyword = params.keyword as string | undefined;
  const appliedStatus = params.status as string | undefined;
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
    appliedStatus
      ? {
          key: 'status',
          label: `状态：${appliedStatus === 'enabled' ? '启用' : '停用'}`,
          onClear: () => {
            setStatus(undefined);
            setQuery({ status: undefined });
          },
        }
      : null,
  ].filter(Boolean) as AppliedFilter[];

  const formOpen = creating || editing !== null;
  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const resetForm = () => {
    setCreating(false);
    setEditing(null);
  };
  const requestCloseForm = useDiscardConfirm(formDirty, resetForm);

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setDraftBase(EMPTY_DRAFT);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (channel: AdminChannelView) => {
    const next = toDraft(channel);
    setDraft(next);
    setDraftBase(next);
    setEditing(channel);
    setCreating(false);
  };

  const submit = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast.error('请填写渠道名称');
      return;
    }
    if (!/^https?:\/\//i.test(draft.baseUrl.trim())) {
      toast.error('Base URL 必须以 http:// 或 https:// 开头');
      return;
    }
    const sortOrder = Number(draft.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      toast.error('排序值必须是非负整数');
      return;
    }
    let headers: unknown = undefined;
    if (draft.headers.trim()) {
      try {
        headers = JSON.parse(draft.headers);
        if (!Array.isArray(headers)) throw new Error('not array');
      } catch {
        toast.error('附加请求头必须是 JSON 数组，如 [{"name":"x-api-version","value":"2"}]');
        return;
      }
    }
    const body: Record<string, unknown> = {
      name,
      baseUrl: draft.baseUrl.trim(),
      proxyUrl: draft.proxyUrl.trim(),
      enabled: draft.enabled,
      sortOrder,
      useGlobalConcurrency: draft.useGlobalConcurrency,
      ...(draft.useGlobalConcurrency ? {} : { concurrencyLimit: Number(draft.concurrencyLimit) || 1 }),
      ...(headers !== undefined ? { headers } : {}),
      ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
    };
    // 空串 = 不修改已有凭证；新建时留空则不配置
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    if (draft.secretKey.trim()) body.secretKey = draft.secretKey.trim();

    setSaving(true);
    try {
      if (editing) {
        await adminChannelsApi.update(editing.id, body);
        toast.success('渠道已保存，目录快照已失效，C 端下次请求即生效');
      } else {
        await adminChannelsApi.create(body);
        toast.success('渠道已创建，请继续在「模型」里补能力与价格');
      }
      resetForm();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (channel: AdminChannelView) => {
    setSaving(true);
    try {
      await adminChannelsApi.duplicate(channel.id);
      toast.success(`已复制渠道「${channel.name}」，请确认凭证与模型后启用`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败');
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await adminChannelsApi.remove(deleteTarget.id, deleteReason.trim() || undefined);
      toast.success(`已删除渠道「${deleteTarget.name}」，凭证已清空`);
      setDeleteTarget(null);
      setDeleteReason('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const payload = await adminChannelsApi.exportAll();
      downloadJson(`channels-${new Date().toISOString().slice(0, 10)}.json`, payload);
      toast.success(`已导出 ${payload.channels?.length ?? 0} 个渠道（不含凭证）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const runImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const payload = JSON.parse(text) as SystemChannelExportView;
      if (!payload || !Array.isArray(payload.channels)) {
        throw new Error('文件不是有效的渠道导出格式（缺少 channels 数组）');
      }
      const result = await adminChannelsApi.importAll(payload);
      const errorText = result.errors?.length ? `，${result.errors.length} 条失败` : '';
      toast.success(
        `导入完成：新建 ${result.createdChannels.length} 个、更新 ${result.updatedChannels.length} 个渠道、保存 ${result.savedModels} 个模型${errorText}`,
      );
      setImportFile(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const columns: Array<AdminColumn<AdminChannelView>> = useMemo(
    () => [
      {
        key: 'name',
        title: '渠道',
        width: 220,
        render: (row) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-text-primary">{row.name}</span>
              {row.enabled ? (
                <StatusTag status="enabled" tone="success" label="启用" />
              ) : (
                <StatusTag status="disabled" tone="muted" label="停用" />
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary" title={row.baseUrl}>
              {row.baseUrl}
            </div>
          </div>
        ),
      },
      {
        key: 'credential',
        title: '凭证',
        width: 110,
        render: (row) =>
          row.hasApiKey ? (
            <div className="flex flex-col gap-0.5 text-[11px]">
              <StatusTag status="key" tone="success" label="Key 已配置" />
              {row.hasSecretKey && <StatusTag status="secret" tone="success" label="Secret 已配置" />}
            </div>
          ) : (
            <StatusTag status="no-key" tone="danger" label="未配置 Key" />
          ),
      },
      {
        key: 'concurrency',
        title: '并发上限',
        width: 90,
        align: 'right',
        render: (row) => (
          <span className="tabular-nums">
            {row.concurrencyLimit === 0 ? '跟随全局' : row.concurrencyLimit}
          </span>
        ),
      },
      {
        key: 'models',
        title: '模型',
        width: 70,
        align: 'right',
        render: (row) => <span className="tabular-nums">{row.modelCosts?.length ?? 0}</span>,
      },
      {
        key: 'proxy',
        title: '出站代理',
        width: 140,
        render: (row) =>
          row.proxyUrl ? (
            <span className="truncate font-mono text-[11px] text-text-secondary" title={row.proxyUrl}>
              {row.proxyUrl}
            </span>
          ) : (
            <span className="text-text-placeholder">直连</span>
          ),
      },
      {
        key: 'updatedAt',
        title: '更新时间',
        width: 150,
        render: (row) => (
          <span className="text-[11px] tabular-nums text-text-tertiary">
            {new Date(row.updatedAt).toLocaleString('zh-CN')}
          </span>
        ),
      },
      {
        key: 'ops',
        title: '操作',
        width: 260,
        fixed: 'right',
        render: (row) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" disabled={!writable} onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setModelsFor(row.id)}>
              模型
            </Button>
            <Button
              variant="ghost"
              size="xs"
              leadingIcon={Copy}
              disabled={!writable || saving}
              onClick={() => void duplicate(row)}
            >
              复制
            </Button>
            <Button
              variant="ghost"
              size="xs"
              leadingIcon={Trash2}
              disabled={!writable}
              onClick={() => {
                setDeleteReason('');
                setDeleteTarget(row);
              }}
            >
              删除
            </Button>
          </div>
        ),
      },
    ],
    // openEdit / duplicate 都是稳定语义；saving、writable 变化需要重算按钮状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saving, writable, setModelsFor],
  );

  const modelsChannel = rows.find((row) => row.id === modelsFor) ?? null;

  return (
    <>
      <PageHeader
        title="渠道工作台"
        description="供应侧配置：Base URL、凭证、并发与出站代理；模型的能力合同与价格档在每行的「模型」里维护。"
        actions={
          <>
            <Button
              variant="secondary"
              size="small"
              leadingIcon={Download}
              disabled={exporting}
              onClick={() => void runExport()}
            >
              {exporting ? '导出中…' : '导出'}
            </Button>
            <Button variant="primary" size="small" leadingIcon={Plus} disabled={!writable} onClick={openCreate}>
              新建渠道
            </Button>
          </>
        }
      />

      <Panel title="导入渠道配置" note="导出文件不含凭证；导入后需要补 API Key 才能调用上游">
        <div className="flex items-center gap-3">
          <FilePick
            file={importFile}
            accept="application/json,.json"
            onPick={setImportFile}
            onClear={() => setImportFile(null)}
            disabled={!writable || importing}
            label="选择导出文件"
            hint="JSON（由本页「导出」生成）"
          />
          <Button
            variant="primary"
            size="small"
            disabled={!importFile || importing || !writable}
            onClick={() => void runImport()}
          >
            {importing ? '导入中…' : '开始导入'}
          </Button>
        </div>
      </Panel>

      <Panel
        title="渠道列表"
        note="删除为软删除：账单、调用记录与审计仍引用渠道 id；凭证会立即清空。"
      >
        <FilterBar>
          <TextInput
            ariaLabel="搜索渠道"
            value={keyword}
            onChange={setKeyword}
            placeholder="搜索渠道名或 Base URL"
            allowClear
            onEnter={() => setQuery({ keyword: keyword.trim() || undefined })}
          />
          <SelectBox
            ariaLabel="渠道状态"
            value={status}
            options={[
              { value: 'enabled', label: '启用' },
              { value: 'disabled', label: '停用' },
            ]}
            allowClear
            onChange={setStatus}
          />
          <FilterActions>
            <Button
              variant="primary"
              size="small"
              onClick={() => setQuery({ keyword: keyword.trim() || undefined, status })}
            >
              查询
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                setKeyword('');
                setStatus(undefined);
                setQuery({ keyword: undefined, status: undefined });
              }}
            >
              重置
            </Button>
          </FilterActions>
          <AppliedFilters
            items={appliedChips}
            onClearAll={() => {
              setKeyword('');
              setStatus(undefined);
              setQuery({ keyword: undefined, status: undefined });
            }}
          />
        </FilterBar>

        {error && rows.length > 0 && <AdminStaleError error={error} onRetry={() => void reload()} />}
        <AdminDataTable<AdminChannelView>
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void reload()}
          emptyText="还没有渠道。新建渠道并导入模型后，C 端才会有可选模型。"
          minWidth={1080}
          pagination={{
            current: Number(params.page ?? 1),
            pageSize: Number(params.pageSize ?? 20),
            total,
            onChange: (page, pageSize) => setPage(page, pageSize),
          }}
        />
      </Panel>

      <Panel
        title="线路健康"
        note="按渠道模型统计：24h / 7d 成功率与 P95 耗时来自调用记录。样本少时 P95 参考意义有限，请同时看样本数。"
      >
        {health.error && healthRows.length === 0 ? (
          <AdminStaleError error={health.error} onRetry={() => void health.reload()} />
        ) : (
          <ChannelModelHealthPanel rows={healthRows} loading={health.loading} />
        )}
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) requestCloseForm();
        }}
        width={640}
        title={editing ? '编辑渠道' : '新建渠道'}
        description={
          formDirty ? '有未保存修改' : editing ? '凭证留空表示不修改现有值' : '创建后请继续在「模型」里补能力与价格'
        }
        footer={
          <>
            <Button variant="secondary" size="small" onClick={requestCloseForm} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" size="small" disabled={saving || !writable} onClick={() => void submit()}>
              {saving ? '保存中…' : editing ? '保存修改' : '创建'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="渠道名称">
              <TextInput
                ariaLabel="渠道名称"
                value={draft.name}
                onChange={(value) => setDraft({ ...draft, name: value })}
                placeholder="如 火山方舟-主"
                maxLength={80}
              />
            </Field>
            <Field label="排序值" hint="数字越小越靠前">
              <NumberInput
                ariaLabel="排序值"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => setDraft({ ...draft, sortOrder: String(value ?? 0) })}
              />
            </Field>
          </div>

          <Field label="Base URL" hint="上游 API 根地址，不含 /v1（协议会自行拼接路径）">
            <TextInput
              ariaLabel="Base URL"
              value={draft.baseUrl}
              onChange={(value) => setDraft({ ...draft, baseUrl: value })}
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="API Key"
              hint={editing?.hasApiKey ? '已配置，留空表示不修改' : '上游访问凭证，仅加密存储、不回显'}
            >
              <TextInput
                ariaLabel="API Key"
                type="password"
                value={draft.apiKey}
                onChange={(value) => setDraft({ ...draft, apiKey: value })}
                placeholder={editing?.hasApiKey ? '••••••（不修改）' : '粘贴上游 Key'}
              />
            </Field>
            <Field
              label="Secret Key"
              hint={editing?.hasSecretKey ? '已配置，留空表示不修改' : '仅 SigV4 / TC3 类协议需要'}
            >
              <TextInput
                ariaLabel="Secret Key"
                type="password"
                value={draft.secretKey}
                onChange={(value) => setDraft({ ...draft, secretKey: value })}
                placeholder={editing?.hasSecretKey ? '••••••（不修改）' : '如无则留空'}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="并发上限" hint="同一渠道同时在跑的请求数">
              <div className="flex items-center gap-3">
                <SwitchBox
                  checked={draft.useGlobalConcurrency}
                  label="跟随全局"
                  ariaLabel="跟随全局并发上限"
                  onChange={(checked) => setDraft({ ...draft, useGlobalConcurrency: checked })}
                />
                {!draft.useGlobalConcurrency && (
                  <NumberInput
                    ariaLabel="并发上限"
                    value={Number(draft.concurrencyLimit) || 1}
                    min={1}
                    max={999}
                    onChange={(value) => setDraft({ ...draft, concurrencyLimit: String(value ?? 1) })}
                  />
                )}
              </div>
            </Field>
            <Field label="出站代理" hint="留空直连；只允许 http/https 代理地址">
              <TextInput
                ariaLabel="出站代理"
                value={draft.proxyUrl}
                onChange={(value) => setDraft({ ...draft, proxyUrl: value })}
                placeholder="http://127.0.0.1:7890"
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border-table px-3 py-2.5">
            <div>
              <div className="text-xs font-medium text-text-primary">启用渠道</div>
              <div className="text-[11px] text-text-tertiary">停用后该渠道的全部模型退出路由目录</div>
            </div>
            <SwitchBox
              checked={draft.enabled}
              ariaLabel="启用渠道"
              onChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />
          </div>

          <Field
            label="附加请求头"
            hint='JSON 数组：[{"name":"x-api-version","value":"2"}]；留空表示不附加'
          >
            <TextArea
              ariaLabel="附加请求头"
              value={draft.headers}
              onChange={(value) => setDraft({ ...draft, headers: value })}
              rows={4}
              placeholder='[{"name": "x-api-version", "value": "2"}]'
            />
          </Field>

          <Field label="变更原因" hint="写入审计，建议写清改了什么（如：更换上游 Key）">
            <TextInput
              ariaLabel="变更原因"
              value={draft.reason}
              onChange={(value) => setDraft({ ...draft, reason: value })}
              placeholder="如：切换到新上游账号"
              maxLength={200}
            />
          </Field>
        </div>
      </Drawer>

      <ChannelModelsDrawer
        channel={modelsChannel}
        open={modelsFor !== null}
        writable={can('channel.model_write')}
        onClose={() => setModelsFor(null)}
        onChanged={() => void reload()}
      />

      <ConfirmAction
        open={deleteTarget !== null}
        title={`删除渠道「${deleteTarget?.name ?? ''}」？`}
        description="软删除：凭证立即清空、渠道与全部模型退出路由；账单与调用记录保留。"
        impact={[
          `该渠道下的 ${deleteTarget?.modelCosts?.length ?? 0} 个模型一并作废`,
          '引用这些模型的前台线路会变为不可用，需要重新选路',
        ]}
        danger
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
        extra={
          <Field label="删除原因" hint="写入审计">
            <TextInput
              ariaLabel="删除原因"
              value={deleteReason}
              onChange={setDeleteReason}
              placeholder="如：上游账号停用"
            />
          </Field>
        }
      />
    </>
  );
}

/**
 * `?channel=` 深链：从任务账单 / 调用记录跳过来时要能直接打开该渠道的模型抽屉。
 * 与 `useAdminDetailParam` 同一套语义，独立一个小 hook 是为了避免它打开通用抽屉。
 */
function useModelsDrawerParam(): [string | null, (id: string | null) => void] {
  const [id, setId] = useAdminDetailParam();
  return [id, setId];
}
