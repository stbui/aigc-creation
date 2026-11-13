import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assetSrc, generateApi, newIdempotencyKey, resolveModelKey } from './api';
import { StateError, StateSkeleton, type LightboxItem } from './components';
import {
  notifyCreditsChanged,
  useApp,
  useAuth,
  useCapabilities,
  useDocumentMeta,
  useGenerateError,
  usePollAbort,
  useLightboxIndex,
} from './hooks';
import { PAGE_SIZE } from './constants';
import {
  outputExtension,
  runtimeOf,
  taskErrorText,
  taskModality,
  toggleInArray,
  toolPath,
  triggerDownload,
  waitForTask,
} from './utils';
import { useWorksFilters, type WorksTab } from './useWorksFilters';
import { useWorksTasks } from './useWorksTasks';
import { WorksHeader } from './WorksHeader';
import { WorksToolbar } from './WorksToolbar';
import { WorksSelectionBar } from './WorksSelectionBar';
import { WorksCountBar } from './WorksCountBar';
import { WorksGrid } from './WorksGrid';
import { WorksLoadMore } from './WorksLoadMore';
import { WorksGuestState } from './WorksGuestState';
import { WorksEmptyState } from './WorksEmptyState';
import type { Task } from '../../types/api';

/**
 * 我的作品。
 *
 * 页面只保留编排与写操作（下载 / 删除 / 重试）；取数与分页在
 * `useWorksTasks.ts`，筛选状态与可见列表在 `useWorksFilters.ts`，
 * 页头 / 工具栏 / 批量条 / 计数行 / 网格 / 空态各自一个展示组件。
 * 分层约定见 `docs/frontend-module-conventions.md`。
 *
 * 卡片: 方形画布 + contain (产出比例不一, 统一裁切会切掉商品主体),
 * 能力名与时间放在白底脚注里, 不再压深色渐变在图片上。
 *
 * 诚实差异:
 *   - 「视频作品」页签按**产出模态**真实过滤（图生视频落地的产物），
 *     没有视频作品时说明视频来自哪项能力，不再弹「未接入视频」的假提示
 *   - 浮层内「重绘」工具列本地真实可跳转的工具页；未实现的项不出现
 *   - 所属任务筛选按**任务 ID / 能力名**检索本地真实任务（参考站为云端任务 ID）
 */
export function WorksPage() {
  useDocumentMeta('我的作品 · 货觉AI', '查看与管理你生成的全部作品。');
  const { message, modal } = useApp();
  const navigate = useNavigate();
  const { token, openLogin } = useAuth();
  const { data: caps } = useCapabilities();
  const reportError = useGenerateError();
  const retrySignal = usePollAbort();

  const [tab, setTab] = useState<WorksTab>('image');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  /** 正在重试的任务 id：按钮显示进度，避免连点重复建单。 */
  const [retryingId, setRetryingId] = useState<string | null>(null);
  /** 重试建单的幂等键：同一次重试的网络抖动复用，拿到 taskId 后清空 */
  const pendingRetryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  /*
   * 首屏（刷新）后可见条数收敛回第一页；「加载更多」成功时向前推进一页。
   * 两个回调必须保持引用稳定，否则取数 hook 会反复重建 `load`。
   */
  const resetVisible = useCallback(() => setVisibleCount(PAGE_SIZE), []);
  const showNextPage = useCallback(() => setVisibleCount((count) => count + PAGE_SIZE), []);
  const {
    tasks,
    totalTasks,
    loading,
    loadingMore,
    error,
    load,
    loadMore,
    addPendingTask,
    dropTask,
  } = useWorksTasks({ onLoaded: resetVisible, onPageLoaded: showNextPage });

  const filters = useWorksFilters({ tasks, caps, tab });
  const { matchingTasks, activeFilterCount } = filters;
  const visibleTasks = matchingTasks.slice(0, visibleCount);

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      matchingTasks
        .filter((task) => task.outputAsset && taskModality(task) !== 'video')
        .map((task) => ({
          id: task.id,
          url: assetSrc(task.outputAsset)!,
          width: task.outputAsset?.width ?? null,
          height: task.outputAsset?.height ?? null,
          createdAt: task.createdAt,
        })),
    [matchingTasks],
  );
  /*
   * 大图查看器的列表取**当前页签下所有已出图的图片作品**, 与网格同源: 在大图里
   * 按 ←/→ 翻的是用户此刻在页面上看到的那一组；下标越界时收敛到最近一张。
   */
  const { index: previewIndex, setIndex: setPreviewIndex, indexById: lightboxIndexById } =
    useLightboxIndex(lightboxItems);
  /** 「张作品」只数有产出的卡片（生成中的占位卡还不是作品） */
  const worksCount = useMemo(
    () => matchingTasks.filter((task) => task.outputAsset).length,
    [matchingTasks],
  );
  /** 可下载的已选作品数。选中生成中的任务时按钮仍需保持禁用。 */
  const downloadableCount = useMemo(
    () => tasks.filter((task) => selectedIds.includes(task.id) && task.outputAsset).length,
    [tasks, selectedIds],
  );

  /**
   * 删除作品。产出图与磁盘文件会一并删除且不可恢复，故必须二次确认 ——
   * hover 浮层里「下载」与「删除」相邻，误点一次就永久丢掉产出。
   */
  const removeTask = (id: string) => {
    modal.confirm({
      title: '删除这个作品？',
      content: '生成图与本地文件会一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await generateApi.remove(id);
          dropTask(id);
          setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
          message.success('已删除作品及其生成图');
        } catch (caught) {
          message.error((caught as Error).message || '删除失败');
        }
      },
    });
  };

  /**
   * 单张作品下载。
   *
   * 必须用 `assetSrc()` 的完整地址，不能用网格里的 640px 缩略图；
   * 鼠标与键盘走同一个函数，避免键盘回车变成“新标签预览”。
   */
  const downloadTask = (task: Task) => {
    const fullUrl = task.outputAsset ? assetSrc(task.outputAsset) : undefined;
    if (!fullUrl) {
      message.warning('该作品没有可下载的产出');
      return;
    }
    const extension = outputExtension(task);
    const anchor = document.createElement('a');
    anchor.href = fullUrl;
    anchor.download = `${task.capability}-${task.id.slice(-6)}.${extension}`;
    anchor.rel = 'noopener';
    anchor.click();
  };

  /**
   * 失败任务重试（PRD F-20）。
   *
   * 直接用原任务的 capability / inputAssetIds / params 新建一次任务，
   * 而不是让用户回到工具页重新填一遍。失败任务在创建时扣过费、失败时已退款，
   * 因此这是一次**新的扣费**，确认框必须写明本次消耗。
   *
   * 输入素材被删除、能力已下线、或能力此刻没有可用通道时不做无意义提交：
   * 先告诉用户原因，再引导回对应工具页重新准备素材。
   */
  const retryTask = (task: Task) => {
    const capability = caps?.items.find((item) => item.id === task.capability);
    if (!capability) {
      message.warning('能力清单尚未加载完成，请稍后再试');
      return;
    }
    const runtime = runtimeOf(capability);
    if (runtime.effective === 'disabled' || runtime.effective === 'unavailable') {
      message.warning(runtime.reason || '该能力当前不可提交，请稍后再试');
      return;
    }
    const inputs = task.inputAssetIds ?? [];
    if ((capability.inputs ?? 0) > 0 && inputs.length < (capability.inputs ?? 0)) {
      message.warning('原任务的输入素材已不存在，请回到工具页重新上传');
      navigate(toolPath(capability.id));
      return;
    }

    // 多图产出按张计费: 原任务参数里带着 batchSize（当初勾了几个模块），
    // 重试会还原整批，合计价必须乘上去，否则提示的金额比实际扣的少
    const shots = Math.max(1, Number(task.params?.batchSize) || 1);
    const totalCost = capability.creditCost * shots;
    const costText = totalCost > 0 ? `本次将消耗 ${totalCost} 积分` : '本次免费';
    modal.confirm({
      title: `重新生成「${capability.name}」？`,
      content: `将沿用原任务的输入图与参数新建一次生成。${costText}；原失败任务已退回的积分不受影响。`,
      okText: '重新生成',
      cancelText: '取消',
      onOk: async () => {
        setRetryingId(task.id);
        try {
          // 沿用原任务的模型：同一提示词换模型往往出完全不同的图，
          // 用户点的是「重新生成」而不是「换个模型试」。
          const modelKey =
            task.modelKey || (await resolveModelKey(task.capability));
          const payload = {
            projectId: task.projectId,
            capability: task.capability,
            modelKey,
            inputAssetIds: inputs,
            params: task.params ?? {},
          };
          const fingerprint = JSON.stringify(payload);
          const idempotencyKey =
            pendingRetryRef.current?.fingerprint === fingerprint
              ? pendingRetryRef.current.key
              : newIdempotencyKey();
          pendingRetryRef.current = { fingerprint, key: idempotencyKey };
          const { taskId } = await generateApi.start({ ...payload, idempotencyKey });
          pendingRetryRef.current = null;
          // 先插一张进行中的卡，用户立刻能看到重试已被受理。
          addPendingTask({
            id: taskId,
            projectId: task.projectId,
            capability: task.capability,
            status: 'queued',
            modelKey,
            inputAssetIds: inputs,
            params: task.params ?? {},
            createdAt: new Date().toISOString(),
          });
          const outcome = await waitForTask(taskId, { signal: retrySignal });
          if (outcome.ok && outcome.task.status === 'succeeded') {
            message.success('重试完成，作品已更新');
          } else if (outcome.ok) {
            message.error(`重试失败：${taskErrorText(outcome.task.errorCode)}`);
          }
          await load();
        } catch (caught) {
          reportError(caught);
          await load();
        } finally {
          setRetryingId(null);
          notifyCreditsChanged();
        }
      },
    });
  };

  const downloadSelected = () => {
    const list = tasks.filter((task) => selectedIds.includes(task.id) && task.outputAsset);
    if (list.length === 0) {
      message.warning('请选择已生成成功的作品');
      return;
    }
    list.forEach((task, index) => {
      const url = assetSrc(task.outputAsset)!;
      if (!url) return;
      // 扩展名跟着产出的真实格式走: 视频是 mp4/webm, 写死 jpg 会让下载的文件打不开
      const extension = outputExtension(task);
      window.setTimeout(() => {
        triggerDownload(url, `${task.capability}-${task.id.slice(-6)}.${extension}`);
      }, index * 220);
    });
    message.success(`已下载 ${list.length} 个文件`);
  };

  /** 「再来一张」：跳回该能力对应的工具页；能力清单未就绪时不做无意义跳转 */
  const reuseWork = (capabilityId: string) => {
    const capability = caps?.items.find((item) => item.id === capabilityId);
    if (capability) navigate(toolPath(capability.id));
  };

  /**
   * 切页签要清掉业务类型筛选: 两个页签的能力集合不相交, 留着上一页的选择
   * 只会得到「没有符合条件」的空网格, 而用户刚点的只是一个页签。
   */
  const switchTab = (next: WorksTab) => {
    setTab(next);
    filters.setSelectedCapabilities([]);
    // 勾选状态跟着视图走：否则切到视频页后“下载所选”仍会带上图片
    setSelectedIds([]);
    setVisibleCount(PAGE_SIZE);
  };

  /*
   * 任一筛选条件变化都清空勾选。批量下载/删除必须只作用于当前可见集合，
   * 否则用户会下载到屏幕上看不到、无法核对的条目。
   */
  useEffect(() => {
    setSelectedIds([]);
  }, [
    tab,
    filters.selectedCapabilities,
    filters.selectedStatuses,
    filters.selectedTaskIds,
    filters.datePreset,
    filters.customRange,
  ]);

  return (
    <div className="my-works-page">
      <WorksHeader
        loading={loading}
        canRefresh={Boolean(token)}
        tab={tab}
        onRefresh={() => void load()}
        onSwitchTab={switchTab}
      />

      <WorksToolbar
        filters={filters}
        selectedCount={selectedIds.length}
        downloadableCount={downloadableCount}
        onDownloadSelected={downloadSelected}
      />

      {selectedIds.length > 0 && (
        <WorksSelectionBar
          selectedCount={selectedIds.length}
          downloadableCount={downloadableCount}
          onDownload={downloadSelected}
          onClear={() => setSelectedIds([])}
        />
      )}

      <WorksCountBar
        worksCount={worksCount}
        pendingCount={matchingTasks.length - worksCount}
        isVideo={tab === 'video'}
      />

      {loading ? (
        /* 骨架屏占住卡片网格的形状 —— 内容到达时零位移 */
        <StateSkeleton variant="card" count={12} columns={6} />
      ) : error ? (
        /* 失败态与空态必须分开: 「没连上」不是「没有作品」 */
        <StateError
          title="作品列表加载失败"
          desc="没能取回你的作品列表。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      ) : !token ? (
        /* 作品与账号绑定: 访客看到「还没有作品」会误以为产出丢了, 直接给登录入口 */
        <WorksGuestState onLogin={openLogin} />
      ) : visibleTasks.length === 0 ? (
        <WorksEmptyState
          tab={tab}
          activeFilterCount={activeFilterCount}
          onGoCreate={() => navigate('/workbench')}
        />
      ) : (
        <>
          <WorksGrid
            tasks={visibleTasks}
            selectedIds={selectedIds}
            lightboxItems={lightboxItems}
            lightboxIndexById={lightboxIndexById}
            previewIndex={previewIndex}
            retryingId={retryingId}
            onToggleSelect={(id) => setSelectedIds((prev) => toggleInArray(prev, id))}
            onPreview={setPreviewIndex}
            onRetry={retryTask}
            onDownload={downloadTask}
            onRemove={removeTask}
            onReuse={reuseWork}
          />

          {(visibleCount < matchingTasks.length || tasks.length < totalTasks) && (
            <WorksLoadMore
              loading={loadingMore}
              remaining={
                Math.max(0, matchingTasks.length - visibleCount) +
                Math.max(0, totalTasks - tasks.length)
              }
              onClick={() => {
                if (visibleCount < matchingTasks.length) {
                  setVisibleCount((count) => count + PAGE_SIZE);
                } else {
                  void loadMore();
                }
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
