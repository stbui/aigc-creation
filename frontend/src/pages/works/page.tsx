import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { assetSrc, generateApi, newIdempotencyKey, resolveModelId } from './api';
import { StateError, StateSkeleton, type LightboxItem } from './components';
import {
  notifyCreditsChanged,
  useApp,
  useAuth,
  useCapabilities,
  useDocumentMeta,
  useGenerateError,
  usePollAbort,
} from './hooks';
import { PAGE_SIZE, SERVER_PAGE_SIZE } from './constants';
import {
  outputExtension,
  runtimeOf,
  taskErrorText,
  taskModality,
  toolPath,
  waitForTask,
} from './utils';
import { useWorksFilters, type WorksTab } from './useWorksFilters';
import { WorksToolbar } from './WorksToolbar';
import { WorksGrid } from './WorksGrid';
import { WorksGuestState, WorksNoWorksState } from './WorksEmptyStates';
import type { Task } from '../../types/api';

/**
 * 我的作品。
 *
 * 版面 (2026-10-30 重排): 回到全站骨架 —— 1120 内容列、24px 标题、令牌配色,
 * 与订单 / 数据中心同一套页头与卡片语言; 原先那版是参考站 (ijihua.cn/my-works)
 * 的逐像素复刻 (逃逸内边距的整幅灰底 / 40px 标题 / 蓝紫混色筛选器), 与站内其它
 * 个人域页面脱节。具体样式见 global.css 的「我的作品」块。
 *
 * 卡片: 方形画布 + contain (产出比例不一, 统一裁切会切掉商品主体),
 * 能力名与「时间 · 尺寸」放在白底脚注里, 不再压深色渐变在图片上。
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

  const [tasks, setTasks] = useState<Task[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 已加载条数（加载更多时作为 offset） */
  const loadedTasksRef = useRef(0);
  /**
   * 加载失败必须与「没有作品」分开存。
   *
   * 失败时不能只弹 `message.error` 再落进空态分支渲染「还没有作品」——
   * 用户看到"你还没有作品", 真相却是"接口没连上", 会以为作品丢了而反复重试。
   */
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorksTab>('image');

  const [selected, setSelected] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  /**
   * 大图查看器的当前下标 (null = 关闭)。
   *
   * 列表取**当前页签下所有已出图的图片作品**, 与网格同源: 在大图里按 ←/→
   * 翻的是用户此刻在页面上看到的那一组, 不会翻到另一个页签或别的筛选结果里。
   */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  /** 正在重试的任务 id：按钮显示进度，避免连点重复建单。 */
  const [retryingId, setRetryingId] = useState<string | null>(null);
  /** 重试建单的幂等键：同一次重试的网络抖动复用，拿到 taskId 后清空 */
  const pendingRetryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await generateApi.listPage({
        limit: SERVER_PAGE_SIZE,
        offset: 0,
        excludeFailed: true,
      });
      // 服务端已排除失败/取消任务；前端再兜一层，避免旧后端 / 缓存响应把无产出终态卡带回来。
      setTasks(page.items.filter((task) => task.status !== 'failed' && task.status !== 'cancelled'));
      setTotalTasks(page.total);
      loadedTasksRef.current = page.items.length;
      setVisibleCount(PAGE_SIZE);
    } catch (e) {
      // 保留上一次数据: 刷新失败不该把已看到的作品清空
      setError((e as Error).message || '作品列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || loadedTasksRef.current >= totalTasks) return;
    setLoadingMore(true);
    try {
      const page = await generateApi.listPage({
        limit: SERVER_PAGE_SIZE,
        offset: loadedTasksRef.current,
        excludeFailed: true,
      });
      const items = page.items.filter((task) => task.status !== 'failed' && task.status !== 'cancelled');
      setTasks((prev) => [...prev, ...items]);
      loadedTasksRef.current += page.items.length;
      setTotalTasks(page.total);
      // 新加载的一页默认只展示首屏数量，用户再点一次即可看到下一批
      setVisibleCount((count) => count + PAGE_SIZE);
    } catch (e) {
      message.error((e as Error).message || '作品加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, message, totalTasks]);

  // 依赖 token: 登录 / 退出都要重新拉取 (与 StatsPage 同构)
  useEffect(() => {
    if (!token) {
      // guest: 作品接口需鉴权, 不发无谓请求 —— 否则首屏会先闪一次「加载失败」
      setTasks([]);
      setTotalTasks(0);
      loadedTasksRef.current = 0;
      setLoading(false);
      return;
    }
    void load();
  }, [token, load]);


  /*
   * 筛选状态与可见列表推导（四个筛选器 + 浮层开合 + 点击空白关闭 + 真实过滤）
   * 都在 `useWorksFilters` 里 —— 页面只取用结果，不再持有这 10 个 state。
   */
  const filters = useWorksFilters({ tasks, caps, tab });
  const { sorted, activeFilterCount } = filters;

  const visible = sorted.slice(0, visibleCount);

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      sorted
        .filter((t) => t.outputAsset && taskModality(t) !== 'video')
        .map((t) => ({
          id: t.id,
          url: assetSrc(t.outputAsset)!,
          width: t.outputAsset?.width ?? null,
          height: t.outputAsset?.height ?? null,
          createdAt: t.createdAt,
        })),
    [sorted],
  );
  /**
   * 「张作品」只数有产出的卡片。
   *
   * 生成中的任务仍以占位卡出现在网格里，但它还不是作品。计数不能直接用
   * `sorted.length`, 否则一个生成中任务就会让我的作品与素材库的生成图数量对不上。
   */
  const worksCount = useMemo(() => sorted.filter((t) => t.outputAsset).length, [sorted]);
  /** 可下载的已选作品数。选中生成中的任务时按钮仍需保持禁用。 */
  const downloadableSelected = useMemo(
    () => tasks.filter((t) => selected.includes(t.id) && t.outputAsset).length,
    [tasks, selected],
  );
  /*
   * 作品被删 / 筛选变化后, 大图查看器的下标可能指向不存在的项。
   * 越界就关掉, 而不是让查看器拿着 undefined 渲染一屏空白。
   */
  useEffect(() => {
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      return prev < lightboxItems.length ? prev : lightboxItems.length > 0 ? lightboxItems.length - 1 : null;
    });
  }, [lightboxItems.length]);

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
          setTasks((prev) => prev.filter((t) => t.id !== id));
          setSelected((prev) => prev.filter((x) => x !== id));
          message.success('已删除作品及其生成图');
        } catch (e) {
          message.error((e as Error).message || '删除失败');
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
  const downloadWork = (t: Task) => {
    const fullUrl = t.outputAsset ? assetSrc(t.outputAsset) : undefined;
    if (!fullUrl) {
      message.warning('该作品没有可下载的产出');
      return;
    }
    const ext = outputExtension(t);
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `${t.capability}-${t.id.slice(-6)}.${ext}`;
    a.rel = 'noopener';
    a.click();
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
  const retryTask = (t: Task) => {
    const def = caps?.items.find((c) => c.id === t.capability);
    if (!def) {
      message.warning('能力清单尚未加载完成，请稍后再试');
      return;
    }
    const rt = runtimeOf(def);
    if (rt.effective === 'disabled' || rt.effective === 'unavailable') {
      message.warning(rt.reason || '该能力当前不可提交，请稍后再试');
      return;
    }
    const inputs = t.inputAssetIds ?? [];
    if ((def.inputs ?? 0) > 0 && inputs.length < (def.inputs ?? 0)) {
      message.warning('原任务的输入素材已不存在，请回到工具页重新上传');
      navigate(toolPath(def.id));
      return;
    }

    // 多图产出按张计费: 原任务参数里带着 batchSize（当初勾了几个模块），
    // 重试会还原整批，合计价必须乘上去，否则提示的金额比实际扣的少
    const shots = Math.max(1, Number(t.params?.batchSize) || 1);
    const totalCost = def.creditCost * shots;
    const costText = totalCost > 0 ? `本次将消耗 ${totalCost} 积分` : '本次免费';
    modal.confirm({
      title: `重新生成「${def.name}」？`,
      content: `将沿用原任务的输入图与参数新建一次生成。${costText}；原失败任务已退回的积分不受影响。`,
      okText: '重新生成',
      cancelText: '取消',
      onOk: async () => {
        setRetryingId(t.id);
        try {
          // 沿用原任务的模型：同一提示词换模型往往出完全不同的图，
          // 用户点的是「重新生成」而不是「换个模型试」。
          const logicalModelId = t.logicalModelId || (await resolveModelId(t.capability));
          const payload = {
            projectId: t.projectId,
            capability: t.capability,
            logicalModelId,
            inputAssetIds: inputs,
            params: t.params ?? {},
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
          setTasks((prev) => [
            {
              id: taskId,
              projectId: t.projectId,
              capability: t.capability,
              status: 'queued',
              logicalModelId,
              inputAssetIds: inputs,
              params: t.params ?? {},
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
          const outcome = await waitForTask(taskId, { signal: retrySignal });
          if (outcome.ok && outcome.task.status === 'succeeded') {
            message.success('重试完成，作品已更新');
          } else if (outcome.ok) {
            message.error(`重试失败：${taskErrorText(outcome.task.errorCode)}`);
          }
          await load();
        } catch (e) {
          reportError(e);
          await load();
        } finally {
          setRetryingId(null);
          notifyCreditsChanged();
        }
      },
    });
  };

  const downloadSelected = () => {
    const list = tasks.filter((t) => selected.includes(t.id) && t.outputAsset);
    if (list.length === 0) {
      message.warning('请选择已生成成功的作品');
      return;
    }
    list.forEach((t, i) => {
      const url = assetSrc(t.outputAsset)!;
      if (!url) return;
      // 扩展名跟着产出的真实格式走: 视频是 mp4/webm, 写死 jpg 会让下载的文件打不开
      const ext = outputExtension(t);
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${t.capability}-${t.id.slice(-6)}.${ext}`;
        a.click();
      }, i * 220);
    });
    message.success(`已下载 ${list.length} 个文件`);
  };

  /**
   * 切页签要清掉业务类型筛选: 两个页签的能力集合不相交, 留着上一页的选择
   * 只会得到「没有符合条件」的空网格, 而用户刚点的只是一个页签。
   */
  const switchTab = (next: WorksTab) => {
    setTab(next);
    filters.setBiz([]);
    // 勾选状态跟着视图走：否则切到视频页后“下载所选”仍会带上图片
    setSelected([]);
    setVisibleCount(PAGE_SIZE);
  };

  /*
   * 任一筛选条件变化都清空勾选。批量下载/删除必须只作用于当前可见集合，
   * 否则用户会下载到屏幕上看不到、无法核对的条目。
   */
  useEffect(() => {
    setSelected([]);
  }, [tab, filters.biz, filters.status, filters.taskPick, filters.datePreset, filters.customRange]);

  return (
    <div className="my-works-page">
      <header className="my-works-head">
        <div className="my-works-heading">
          <h1>我的作品</h1>
          <p>所有生成产出都汇总在这里，可查看大图、批量下载或再次创作。</p>
        </div>
        <button
          type="button"
          className="my-works-refresh"
          disabled={loading || !token}
          onClick={() => void load()}
        >
          <RefreshCw size={14} className={loading ? 'my-work-generating-spinner' : undefined} />
          刷新
        </button>
      </header>
      <div className="my-works-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'image'}
          className={tab === 'image' ? 'active' : ''}
          onClick={() => switchTab('image')}
        >
          图片作品
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'video'}
          className={tab === 'video' ? 'active' : ''}
          onClick={() => switchTab('video')}
        >
          视频作品
        </button>
      </div>

      <WorksToolbar
        filters={filters}
        selected={selected}
        downloadableSelected={downloadableSelected}
        downloadSelected={downloadSelected}
      />

      {/* 多选操作条（选择任一卡片后出现，实测 spec: #5B4BD7 on #F1EFFF） */}
      {selected.length > 0 && (
        <div className="my-works-selection-bar">
          <span>已选 {selected.length} 个作品</span>
          <button
            type="button"
            disabled={downloadableSelected === 0}
            onClick={downloadSelected}
          >
            <Download size={11} /> 下载所选
          </button>
          <button
            type="button"
            className="my-works-selection-exit"
            onClick={() => setSelected([])}
          >
            取消选择
          </button>
        </div>
      )}

      <div className="my-works-count-row">
        <span>
          {worksCount} {tab === 'video' ? '个视频' : '张作品'}
          {sorted.length > worksCount && (
            <em className="my-works-count-extra">
              {/* 生成中的任务仍在网格里, 但不算作品 —— 在这里说清楚, 不藏 */}
              {' · 另有 '}
              {sorted.length - worksCount}
              {' 个未出图任务'}
            </em>
          )}
        </span>
        <span className="my-works-sort-label">按创作日期倒序</span>
      </div>

      {loading ? (
        /* 骨架屏占住卡片网格的形状 —— 内容到达时零位移;
           否则网格区域会先塌陷再撑开, 页面明显跳动。 */
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
      ) : visible.length === 0 ? (
        <WorksNoWorksState
          tab={tab}
          activeFilterCount={activeFilterCount}
          onGoCreate={() => navigate('/workbench')}
        />
      ) : (
        <>
          <WorksGrid
            visible={visible}
            selected={selected}
            onToggleSelect={(id) => filters.toggleIn(selected, id, setSelected)}
            lightboxItems={lightboxItems}
            previewIndex={previewIndex}
            setPreviewIndex={setPreviewIndex}
            retryingId={retryingId}
            retryTask={retryTask}
            downloadWork={downloadWork}
            removeTask={removeTask}
          />

          {(visibleCount < sorted.length || tasks.length < totalTasks) && (
            <button
              type="button"
              className="my-works-load-more"
              disabled={loadingMore}
              onClick={() => {
                if (visibleCount < sorted.length) {
                  setVisibleCount((c) => c + PAGE_SIZE);
                } else {
                  void loadMore();
                }
              }}
            >
              <ChevronDown size={14} />
              {loadingMore
                ? '加载中…'
                : `加载更多（还有 ${Math.max(0, sorted.length - visibleCount) + Math.max(0, totalTasks - tasks.length)} 个）`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
