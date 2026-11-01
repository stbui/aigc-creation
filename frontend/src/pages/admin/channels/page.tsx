import { useCallback, useState } from 'react';
import { adminChannelsApi } from './api';
import {
  AdminStaleError,
  ConfirmAction,
  PageHeader,
  Panel,
  SegmentedBox,
  TextInput,
} from './components';
import {
  useAdmin,
  useAdminDetailParam,
  useChannelFilters,
  useChannelHealth,
  useChannelList,
  useConfirm,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { AllChannelModelsPanel } from './AllChannelModelsPanel';
import { ChannelDetailPanel } from './ChannelDetailPanel';
import { ChannelFormDrawer } from './ChannelFormDrawer';
import { ChannelListPanel } from './ChannelListPanel';
import { ChannelModelHealthPanel } from './ChannelModelHealthPanel';
import { ChannelOrderDialog } from './ChannelOrderDialog';
import { Field } from './ChannelField';
import {
  CHANNEL_VIEW_OPTIONS,
  EMPTY_CHANNEL_DRAFT,
  type ChannelDraft,
} from './constants';
import { normalizeChannelHeaders, toChannelDraft, validateChannelHeaders } from './utils';
import type { AdminChannelView, SystemChannelExportView } from '../../../types/model';

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
 *
 * ## 两个并列视图
 *
 * 「按渠道」是配置动线（建渠道 → 配模型 → 定价）；「全部模型」是排障动线
 * （哪家在挂、这条线加价多少）。两者看的不是同一批问题，所以做成切换
 * 而不是把跨渠道内容塞进渠道列表。
 *
 * ## 为什么要「左列 + 右侧详情」而不是表格
 *
 * 配置一个渠道是「选渠道 → 反复改它下面的模型与价格」的循环。表格每改一次
 * 都要弹一次抽屉、关一次抽屉，选中态还会丢。左列常驻列表 + 右侧常驻详情，
 * 让「换渠道」和「改模型」都只有一次点击。
 *
 * ## 模块划分
 *
 * - `api.ts`：列表全量拉取与健康指标入口；
 * - `hooks.ts`：列表 / 筛选 / 健康三份页面状态；
 * - `ChannelListPanel` / `ChannelDetailPanel` / `ChannelFormDrawer`：三块 UI；
 * - 本文件只保留页面编排与写操作（新建、复制、启停、删除、导入导出）。
 */

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
  const confirm = useConfirm();
  const { can } = useAdmin();
  const writable = can('channel.write');

  const { rows, loading, error, reload } = useChannelList();
  const { keyword, status, setKeyword, setStatus, visible, clearFilters, hasFilters } =
    useChannelFilters(rows);
  const health = useChannelHealth();

  /** 视图切换：`channels` = 按渠道配置，`models` = 跨渠道排查 */
  const [view, setView] = useState<'channels' | 'models'>('channels');

  const [editing, setEditing] = useState<AdminChannelView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ChannelDraft>(EMPTY_CHANNEL_DRAFT);
  const [draftBase, setDraftBase] = useState<ChannelDraft>(EMPTY_CHANNEL_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminChannelView | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  /** 启停确认：停用会让该渠道的模型整体退出路由目录，要二次确认 */
  const [toggleTarget, setToggleTarget] = useState<AdminChannelView | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  /** 选中渠道走后地址栏 `?id=`：从账单 / 调用记录跳过来要能直达 */
  const [selectedId, setSelectedId] = useAdminDetailParam();
  /** 排序弹窗：`null` 关闭；有渠道 id = 排该渠道下的模型，空串 = 排渠道 */
  const [orderFor, setOrderFor] = useState<string | null>(null);
  /** 从「全部模型」点编辑时要打开的模型 id：切回渠道视图后由模型工作台消费并清空 */
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);

  /** 从「全部模型」跳回「按渠道」：清筛选，否则目标渠道可能不在可见列表里 */
  const openChannel = useCallback(
    (channelId: string) => {
      clearFilters();
      setSelectedId(channelId);
      setView('channels');
    },
    [clearFilters, setSelectedId],
  );

  /**
   * 从「全部模型」直接编辑某条线路：先切回该渠道，再把模型 id 交给模型工作台
   * 打开编辑器 —— 跨渠道视图的编辑动线不该要求用户自己回去翻清单。
   */
  const openChannelModel = useCallback(
    (channelId: string, modelId: string) => {
      openChannel(channelId);
      setPendingModelId(modelId);
    },
    [openChannel],
  );

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const formOpen = creating || editing !== null;
  const formDirty = formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase);
  useUnsavedGuard(formDirty);

  const resetForm = () => {
    setCreating(false);
    setEditing(null);
  };
  const requestCloseForm = useDiscardConfirm(formDirty, resetForm);

  const updateDraft = (patch: Partial<ChannelDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const openCreate = () => {
    setDraft(EMPTY_CHANNEL_DRAFT);
    setDraftBase(EMPTY_CHANNEL_DRAFT);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (channel: AdminChannelView) => {
    const next = toChannelDraft(channel);
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
    const headerError = validateChannelHeaders(draft.headers);
    if (headerError) {
      toast.error(headerError);
      return;
    }
    // 新建渠道没有凭证就是一条永远 401 的线路，建出来只会污染路由目录
    if (!editing && !draft.apiKey.trim()) {
      toast.error('请填写 API Key 或 Access Key');
      return;
    }
    const body: Record<string, unknown> = {
      name,
      baseUrl: draft.baseUrl.trim(),
      proxyUrl: draft.proxyUrl.trim(),
      enabled: draft.enabled,
      sortOrder,
      useGlobalConcurrency: draft.useGlobalConcurrency,
      ...(draft.useGlobalConcurrency
        ? {}
        : { concurrencyLimit: Number(draft.concurrencyLimit) || 1 }),
      // 空数组 = 显式清空，`undefined` 才是「不修改」
      headers: normalizeChannelHeaders(draft.headers),
      ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
    };
    // 空串 = 不修改已有凭证；新建时必填
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    if (draft.secretKey.trim()) body.secretKey = draft.secretKey.trim();

    setSaving(true);
    try {
      if (editing) {
        await adminChannelsApi.update(editing.id, body);
        toast.success('渠道已保存，目录快照已失效，C 端下次请求即生效');
      } else {
        const created = await adminChannelsApi.create(body);
        toast.success('渠道已创建，请继续在右侧补模型与价格');
        // 新建后清掉筛选并直接选中：下一步一定是配模型，不能被筛选挡在列表外
        clearFilters();
        if (created?.id) setSelectedId(created.id);
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
      const copy = await adminChannelsApi.duplicate(channel.id);
      toast.success(`已复制渠道「${channel.name}」，请确认凭证与模型后启用`);
      // 复制的目的是接着改副本：清筛选并选中它，省一次点击
      clearFilters();
      if (copy?.id) setSelectedId(copy.id);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败');
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    // 删除是高危动作（channel.write）：原因必填，后端也会拒收空原因
    if (deleteReason.trim().length === 0) {
      toast.error('必须填写变更原因');
      return;
    }
    setSaving(true);
    try {
      await adminChannelsApi.remove(deleteTarget.id, deleteReason.trim());
      toast.success(`已删除渠道「${deleteTarget.name}」，凭证已清空`);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      setDeleteReason('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  /** 导出单渠道或全部：文件不含任何凭证，`ids` 为空时导出全部 */
  const runExport = async (target?: AdminChannelView) => {
    setExporting(true);
    try {
      const payload = target
        ? await adminChannelsApi.exportAll([target.id])
        : await adminChannelsApi.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(
        target ? `system-channel-${target.name}-${stamp}.json` : `system-channels-${stamp}.json`,
        payload,
      );
      toast.success(`已导出 ${payload.channels?.length ?? 0} 个渠道（不含凭证）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  /**
   * 启用 / 停用渠道：只改 `enabled`，凭证、模型与价格原样保留。
   * 停用不等于删除 —— 它退出路由目录，但仍在列表里，随时可以切回。
   */
  const runToggle = async () => {
    if (!toggleTarget) return;
    const next = !toggleTarget.enabled;
    setSaving(true);
    try {
      await adminChannelsApi.update(toggleTarget.id, {
        enabled: next,
        reason: next ? '后台启用渠道' : '后台停用渠道',
      });
      toast.success(
        next ? `已启用渠道「${toggleTarget.name}」` : `已停用渠道「${toggleTarget.name}」`,
      );
      setToggleTarget(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '更新渠道状态失败');
    } finally {
      setSaving(false);
    }
  };

  const runImport = async () => {
    if (!importFile) return;
    let payload: SystemChannelExportView;
    try {
      payload = JSON.parse(await importFile.text()) as SystemChannelExportView;
    } catch {
      toast.error('导入文件不是有效的 JSON');
      return;
    }
    if (!payload || !Array.isArray(payload.channels) || payload.channels.length === 0) {
      toast.error('文件不是有效的渠道导出格式（缺少 channels 数组）');
      return;
    }
    const names = payload.channels.map((item) => item.name).filter(Boolean);
    // 导入是按名称合并的覆盖式写入，先让用户看清会动到哪些渠道再执行
    const preview = `${names.slice(0, 8).join('、')}${names.length > 8 ? ` 等 ${names.length} 个` : ''}`;
    const confirmed = await confirm({
      title: `导入 ${names.length} 个渠道？`,
      description: `${preview}。按渠道名称合并：同名渠道保留现有凭证与启停状态，只更新地址、并发与文件中的模型；新渠道创建为停用状态，填写 API Key 后再启用；文件中没有的模型保持不变。`,
      confirmText: '开始导入',
    });
    if (confirmed === null) return;

    setImporting(true);
    try {
      const result = await adminChannelsApi.importAll(payload);
      const summary = `新建 ${result.createdChannels.length} 个、更新 ${result.updatedChannels.length} 个渠道、保存 ${result.savedModels} 个模型`;
      if (result.errors?.length) {
        toast.error(`${summary}；${result.errors.length} 条失败：${result.errors.slice(0, 3).join('；')}`);
      } else {
        toast.success(
          result.createdChannels.length ? `${summary}；新渠道需填写 API Key 后启用` : summary,
        );
      }
      setImportFile(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const orderChannel = orderFor ? (rows.find((row) => row.id === orderFor) ?? null) : null;

  return (
    <>
      <PageHeader
        title="渠道工作台"
        description="供应侧配置：Base URL、凭证、并发与出站代理；选中左侧渠道后，在右侧维护它的模型、能力合同与价格档。"
      />

      <div className="mb-3 flex items-center gap-2">
        <SegmentedBox
          ariaLabel="渠道工作台视图"
          value={view}
          onChange={(value) => setView(value === 'models' ? 'models' : 'channels')}
          options={CHANNEL_VIEW_OPTIONS}
        />
      </div>

      {view === 'models' ? (
        /* 同页还有「线路健康」表格，视觉定位用容器包一层，测试按容器取行 */
        <div data-testid="admin-all-models">
          <Panel
            title="全部模型"
            note="跨渠道视图：一次看遍所有线路的稳定性、成本与售价。停用的模型也会列出，便于排查与重新启用。"
          >
            <AllChannelModelsPanel
              writable={can('channel.model_write')}
              onChanged={() => void reload()}
              onOpenChannel={openChannel}
              onEditModel={openChannelModel}
            />
          </Panel>
        </div>
      ) : (
        <div
          className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-3"
          data-testid="admin-channel-workspace"
        >
          <ChannelListPanel
            rows={rows}
            visible={visible}
            loading={loading}
            error={error}
            hasFilters={hasFilters}
            keyword={keyword}
            status={status}
            selectedId={selectedId}
            healthByChannel={health.byChannel}
            writable={writable}
            importing={importing}
            exporting={exporting}
            importFile={importFile}
            onKeywordChange={setKeyword}
            onStatusChange={setStatus}
            onClearFilters={clearFilters}
            onSelect={setSelectedId}
            onRetry={() => void reload()}
            onCreate={openCreate}
            onExportAll={() => void runExport()}
            onPickImportFile={(file) => setImportFile(file)}
            onClearImportFile={() => setImportFile(null)}
            onImport={() => void runImport()}
            onReorder={() => setOrderFor('')}
          />

          <ChannelDetailPanel
            selected={selected}
            loading={loading}
            error={error}
            hasFilters={hasFilters}
            writable={writable}
            modelWritable={can('channel.model_write')}
            saving={saving}
            exporting={exporting}
            pendingModelId={pendingModelId}
            onEdit={openEdit}
            onDuplicate={(channel) => void duplicate(channel)}
            onExport={(channel) => void runExport(channel)}
            onToggle={setToggleTarget}
            onDelete={(channel) => {
              setDeleteReason('');
              setDeleteTarget(channel);
            }}
            onCreate={openCreate}
            onChanged={() => void reload()}
            onFocusConsumed={() => setPendingModelId(null)}
          />
        </div>
      )}

      <div className="mt-3">
        <Panel
          title="线路健康"
          note="按渠道模型统计：24h / 7d 成功率与 P95 耗时来自调用记录。样本少时 P95 参考意义有限，请同时看样本数。"
        >
          {health.error && health.rows.length === 0 ? (
            <AdminStaleError error={health.error} onRetry={() => void health.reload()} />
          ) : (
            <ChannelModelHealthPanel rows={health.rows} loading={health.loading} />
          )}
        </Panel>
      </div>

      <ChannelFormDrawer
        open={formOpen}
        editing={editing}
        draft={draft}
        dirty={formDirty}
        saving={saving}
        writable={writable}
        onChange={updateDraft}
        onClose={requestCloseForm}
        onSubmit={() => void submit()}
      />

      <ChannelOrderDialog
        open={orderFor !== null}
        channelId={orderFor === '' ? undefined : (orderFor ?? undefined)}
        channelName={orderChannel?.name}
        onClose={() => setOrderFor(null)}
        onSaved={() => void reload()}
      />

      <ConfirmAction
        open={toggleTarget !== null}
        title={
          toggleTarget?.enabled
            ? `停用渠道「${toggleTarget?.name}」？`
            : `启用渠道「${toggleTarget?.name}」？`
        }
        description={
          toggleTarget?.enabled
            ? '停用后新任务不会再使用该渠道，但仍会保留在列表中，可随时重新启用。'
            : '启用后，配置完整的模型会重新进入系统可用模型集合。'
        }
        impact={
          toggleTarget?.enabled
            ? [
                `该渠道下的 ${toggleTarget?.modelCosts?.length ?? 0} 个模型同时退出路由目录`,
                '引用这些模型的前台线路会变为不可用，C 端可能报「无可用线路」',
              ]
            : ['只恢复配置完整（有价格档、已启用）的模型，其余仍不可用']
        }
        danger={Boolean(toggleTarget?.enabled)}
        confirmText={toggleTarget?.enabled ? '确认停用' : '确认启用'}
        loading={saving}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void runToggle()}
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
        confirmDisabled={deleteReason.trim().length === 0}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void runDelete()}
        extra={
          <Field
            label="删除原因"
            hint="写入审计：审计要能回答「谁为什么删」"
            error={deleteReason.trim().length === 0 ? '删除是高危操作，必须填写原因' : null}
          >
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
