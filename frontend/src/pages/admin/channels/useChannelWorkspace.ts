import { useCallback, useMemo, useState } from 'react';
import { adminChannelsApi } from './api';
import { downloadJson } from '../../../lib/download';
import {
  useActionLock,
  useAdmin,
  useAdminDetailParam,
  useChannelFilters,
  useChannelHealth,
  useChannelList,
  useChannelSelection,
  useChannelView,
  useConfirm,
  useDiscardConfirm,
  useToast,
  useUnsavedGuard,
} from './hooks';
import { EMPTY_CHANNEL_DRAFT, type ChannelDraft } from './constants';
import {
  buildDefaultModelPayload,
  normalizeChannelHeaders,
  toChannelDraft,
  validateChannelHeaders,
} from './utils';
import { useProductConsumption } from './useProductConsumption';
import type { AdminChannelView, SystemChannelExportView } from '../../../types/model';

/**
 * 渠道工作台的状态与写操作。
 *
 * 页面文件只负责把返回值拼成布局；列表、筛选、选中、表单草稿、导入导出与
 * 启停删除都留在这里。这样新增一个动作时不会继续把 `page.tsx` 撑成第二套
 * 业务组件，同时让异步写操作可以独立测试。
 */
export function useChannelWorkspace() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAdmin();

  const { rows, loading, error, reload } = useChannelList();
  const { keyword, status, setKeyword, setStatus, visible, clearFilters, hasFilters } =
    useChannelFilters(rows);
  const health = useChannelHealth();
  /** 商品被哪些能力消费：渠道侧只读，用于“这个商品能不能动”的判断 */
  const consumption = useProductConsumption();

  /** 视图以地址栏为准：排障链接可直接分享，前进 / 后退也能正确切换。 */
  const [view, setView] = useChannelView();

  const [editing, setEditing] = useState<AdminChannelView | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ChannelDraft>(EMPTY_CHANNEL_DRAFT);
  const [draftBase, setDraftBase] = useState<ChannelDraft>(EMPTY_CHANNEL_DRAFT);
  const { busy: saving, run: runSaving } = useActionLock();
  const [deleteTarget, setDeleteTarget] = useState<AdminChannelView | null>(null);
  /** 启停确认：停用会让该渠道的模型整体退出路由目录，要二次确认 */
  const [toggleTarget, setToggleTarget] = useState<AdminChannelView | null>(null);
  const { busy: exporting, run: runExporting } = useActionLock();
  const [importFile, setImportFile] = useState<File | null>(null);
  const { busy: importing, run: runImporting } = useActionLock();
  /** 选中渠道走后地址栏 `?id=`：从账单 / 调用记录跳过来要能直达 */
  const [selectedId, setSelectedId] = useAdminDetailParam();
  /** 排序弹窗：`null` 关闭；有渠道 id = 排该渠道下的模型，空串 = 排渠道 */
  const [orderFor, setOrderFor] = useState<string | null>(null);
  /** 从「商品台账」点编辑时要打开的商品 id：切回供应商视图后由商品工作台消费并清空 */
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  /** 新建成功后自动打开上游导入：把「接入供应商」接成两步，而不是建完再找入口 */
  const [autoUpstreamFor, setAutoUpstreamFor] = useState<string | null>(null);

  useChannelSelection({ visible, loading, error, view, selectedId, setSelectedId });

  /** 从「商品台账」跳回「供应商」：清筛选，否则目标供应商可能不在可见列表里 */
  const openChannel = useCallback(
    (channelId: string) => {
      clearFilters();
      setSelectedId(channelId);
      setView('channels');
    },
    [clearFilters, setSelectedId, setView],
  );

  /**
   * 从「商品台账」直接编辑某个商品：先切回该供应商，再把商品 id 交给商品工作台
   * 打开编辑器 —— 跨供应商视图的编辑动线不该要求用户自己回去翻清单。
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
  // 序列化只在草稿变化时做一次：表单输入密集，逐次渲染比对整份草稿没有意义
  const formDirty = useMemo(
    () => formOpen && JSON.stringify(draft) !== JSON.stringify(draftBase),
    [formOpen, draft, draftBase],
  );
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
      toast.error('请填写供应商名称');
      return;
    }
    if (!/^https?:\/\//i.test(draft.baseUrl.trim())) {
      toast.error('请填写有效的服务地址（以 http:// 或 https:// 开头）');
      return;
    }
    const sortOrder = Number(draft.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      toast.error('展示顺序必须是非负整数');
      return;
    }
    const headerError = validateChannelHeaders(draft.headers);
    if (headerError) {
      toast.error(headerError);
      return;
    }
    const defaultModel = buildDefaultModelPayload(draft.defaultModel);
    if ('error' in defaultModel) {
      toast.error(defaultModel.error);
      return;
    }
    // 新建渠道没有凭证就是一条永远 401 的线路，建出来只会污染路由目录
    if (!editing && !draft.apiKey.trim()) {
      toast.error('请填写访问凭证');
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
      // null = 清空默认配置；对象 = 保存后自动套用到新建 / 导入的商品
      defaultModel: defaultModel.value,
    };
    // 空串 = 不修改已有凭证；新建时必填
    if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim();
    if (draft.secretKey.trim()) body.secretKey = draft.secretKey.trim();

    await runSaving(async () => {
      try {
        if (editing) {
          await adminChannelsApi.update(editing.id, body);
          toast.success('供应商已保存，新的配置将用于后续任务');
        } else {
          const created = await adminChannelsApi.create(body);
          toast.success('供应商已接入，请继续添加商品与售价');
          // 新建后清掉筛选并直接选中：下一步一定是配模型，不能被筛选挡在列表外
          clearFilters();
          if (created?.id) {
            setSelectedId(created.id);
            // 自动打开上游导入：运营建供应商的下一步就是拉商品
            setAutoUpstreamFor(created.id);
          }
        }
        resetForm();
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '保存失败');
      }
    });
  };

  const duplicate = async (channel: AdminChannelView) => {
    await runSaving(async () => {
      try {
        const copy = await adminChannelsApi.duplicate(channel.id);
        toast.success(`已复制供应商「${channel.name}」，请确认访问凭证与商品后启用`);
        // 复制的目的是接着改副本：清筛选并选中它，省一次点击
        clearFilters();
        if (copy?.id) setSelectedId(copy.id);
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '复制失败');
      }
    });
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    await runSaving(async () => {
      try {
        await adminChannelsApi.remove(deleteTarget.id);
        toast.success(`已删除供应商「${deleteTarget.name}」，访问凭证已清除`);
        if (selectedId === deleteTarget.id) setSelectedId(null);
        setDeleteTarget(null);
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '删除失败');
      }
    });
  };

  /** 导出单渠道或全部：文件不含任何凭证，`ids` 为空时导出全部 */
  const runExport = async (target?: AdminChannelView) => {
    await runExporting(async () => {
      try {
        const payload = target
          ? await adminChannelsApi.exportAll([target.id])
          : await adminChannelsApi.exportAll();
        const stamp = new Date().toISOString().slice(0, 10);
        downloadJson(
          payload,
          target ? `system-channel-${target.name}-${stamp}.json` : `system-channels-${stamp}.json`,
        );
        toast.success(`已导出 ${payload.channels?.length ?? 0} 个渠道（不含凭证）`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '导出失败');
      }
    });
  };

  /**
   * 启用 / 停用渠道：只改 `enabled`，凭证、模型与价格原样保留。
   * 停用不等于删除 —— 它退出路由目录，但仍在列表里，随时可以切回。
   */
  const runToggle = async () => {
    if (!toggleTarget) return;
    const next = !toggleTarget.enabled;
    await runSaving(async () => {
      try {
        await adminChannelsApi.update(toggleTarget.id, { enabled: next });
        toast.success(
          next ? `已启用供应商「${toggleTarget.name}」` : `已停用供应商「${toggleTarget.name}」`,
        );
        setToggleTarget(null);
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '更新渠道状态失败');
      }
    });
  };

  const runImport = async () => {
    if (!importFile) return;
    await runImporting(async () => {
      let payload: SystemChannelExportView;
      try {
        payload = JSON.parse(await importFile.text()) as SystemChannelExportView;
      } catch {
        toast.error('导入文件格式不正确');
        return;
      }
      if (!payload || !Array.isArray(payload.channels) || payload.channels.length === 0) {
        toast.error('文件不是有效的渠道导出文件（缺少渠道数据）');
        return;
      }
      const names = payload.channels.map((item) => item.name).filter(Boolean);
      // 导入是按名称合并的覆盖式写入，先让用户看清会动到哪些供应商再执行
      const preview = `${names.slice(0, 8).join('、')}${names.length > 8 ? ` 等 ${names.length} 个` : ''}`;
      const confirmed = await confirm({
        title: `导入 ${names.length} 个供应商？`,
        description: `${preview}。按供应商名称合并：同名供应商保留现有访问凭证与启停状态，只更新服务地址、任务数与文件中的商品；新供应商创建为停用状态，填写访问凭证后再启用；文件中没有的商品保持不变。`,
        confirmText: '开始导入',
      });
      if (confirmed === null) return;

      try {
        const result = await adminChannelsApi.importAll(payload);
        const summary = `新建 ${result.createdChannels.length} 个、更新 ${result.updatedChannels.length} 个供应商、保存 ${result.savedModels} 个商品`;
        if (result.errors?.length) {
          toast.error(`${summary}；${result.errors.length} 条失败：${result.errors.slice(0, 3).join('；')}`);
        } else {
          toast.success(
            result.createdChannels.length ? `${summary}；新供应商需填写访问凭证后启用` : summary,
          );
        }
        setImportFile(null);
        await reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '导入失败');
      }
    });
  };

  const orderChannel = orderFor ? (rows.find((row) => row.id === orderFor) ?? null) : null;

  return {
    view,
    setView,
    writable: can('channel.write'),
    modelWritable: can('channel.model_write'),
    canTest: can('channel.test'),
    canReadCapabilities: can('capability.read') || can('logical_model.read'),
    canReadPlugins: can('plugin.read'),
    rows,
    loading,
    error,
    reload,
    keyword,
    status,
    setKeyword,
    setStatus,
    visible,
    clearFilters,
    hasFilters,
    health,
    consumption,
    selectedId,
    setSelectedId,
    selected,
    openChannel,
    openChannelModel,
    editing,
    draft,
    formOpen,
    formDirty,
    saving,
    updateDraft,
    openCreate,
    openEdit,
    requestCloseForm,
    submit,
    duplicate,
    deleteTarget,
    setDeleteTarget,
    runDelete,
    toggleTarget,
    setToggleTarget,
    runToggle,
    exporting,
    runExport,
    importing,
    importFile,
    setImportFile,
    runImport,
    orderFor,
    setOrderFor,
    orderChannel,
    pendingModelId,
    setPendingModelId,
    autoUpstreamFor,
    setAutoUpstreamFor,
  };
}
