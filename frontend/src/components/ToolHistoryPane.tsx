import { useContext, useEffect, useRef, useState } from 'react';
import { App, Drawer, Spin } from 'antd';
import { ChevronUp, Download, History, ImageOff, Maximize2, RefreshCw } from 'lucide-react';
import { assetSrc, assetThumbSrc, generateApi } from '../lib/api';
import { loadModels, modelsSync } from '../lib/models';
import { useAuth } from '../context/AuthContext';
import { ImageLightbox } from './ImageLightbox';
import { ToolTrailingContext } from './ToolShell';
import { StateError } from './StateViews';

/**
 * 修图工具的通用历史侧栏。
 *
 * 参考站各修图页右侧都有结果历史；这里统一按能力过滤真实任务，刷新键
 * 通常是当前结果 URL：新任务完成时页面拿到的 result 变化，历史随即重新
 * 拉取。加载中、失败与空列表分开显示，避免把网络失败误报成「暂无记录」。
 *
 * 历史卡动作与参考站保持一致：
 *   - 预览：打开共享 ImageLightbox（缩放/翻页/下载/失败重载）；
 *   - 再次使用：把当时的产出复制回当前项目并放入上传位，供继续改图；
 *   - 下载：直接下载历史原图。
 *
 * 参考站另有「反馈」入口，但依赖其私有反馈接口；本站没有对应契约，
 * 因此不做一个点了没反应的假按钮。
 */

export type ToolHistoryTask = Awaited<ReturnType<typeof generateApi.list>>[number];

export function useToolHistory(capability: string, refreshKey?: unknown) {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<ToolHistoryTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) {
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void generateApi
      .listPage({ capability, limit: 50, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        setTasks(
          page.items
            .filter((task) => task.status === 'succeeded' && task.outputAsset)
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            .slice(0, 24),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setTasks([]);
          setError((e as Error).message || '历史记录加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capability, refreshKey, token, reloadKey]);

  return { tasks, loading, error, retry: () => setReloadKey((value) => value + 1) };
}

/**
 * 历史卡列表本体。局部重绘仍使用自己的三栏折叠结构，但历史卡交互必须
 * 与其他修图页同源，故单独导出，避免再复制一份预览/复用/下载逻辑。
 */
export function ToolHistoryGrid({
  tasks,
  loading,
  error,
  emptyText,
  onRetry,
}: {
  tasks: ToolHistoryTask[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  onRetry: () => void;
}) {
  const { message } = App.useApp();
  const trailing = useContext(ToolTrailingContext);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reusingId, setReusingId] = useState<string | null>(null);
  /** state 更新到下一次渲染前仍可能是 null；ref 负责拦住同一帧的连点。 */
  const reusingRef = useRef(false);
  const previewItems = tasks
    .map((task) => ({
      id: task.id,
      url: assetSrc(task.outputAsset) ?? '',
      width: task.outputAsset?.width,
      height: task.outputAsset?.height,
      createdAt: task.createdAt,
    }))
    .filter((item) => item.url);
  const previewIndex = previewUrl ? previewItems.findIndex((item) => item.url === previewUrl) : -1;

  /**
   * 历史卡上如实标出「用了哪个模型、扣了多少积分」。
   *
   * 只显示前台模型名，不显示渠道 / 上游：渠道是实现细节，用户买的是产品；
   * 但价格必须对照任务快照（`task.creditCost`），不按当前价重算 —— 改价后
   * 历史记录回看时金额会与当时扣费不一致，那是最难解释的一类客诉。
   */
  const modelNames = useModelNames();

  const reuse = async (task: ToolHistoryTask) => {
    if (!trailing?.reuseTask || reusingRef.current) return;
    reusingRef.current = true;
    setReusingId(task.id);
    try {
      const accepted = await trailing.reuseTask(task);
      if (!accepted) message.warning('当前页面无法复用这条历史结果');
    } catch (e) {
      message.error((e as Error).message || '历史结果复用失败，请重试');
    } finally {
      reusingRef.current = false;
      setReusingId(null);
    }
  };

  return (
    <>
      <div className="redraw-history-scroll">
        {loading ? (
          <div className="redraw-history-loading" aria-live="polite">
            <Spin size="small" />
            <span>加载中…</span>
          </div>
        ) : error ? (
          <StateError
            compact
            title="历史记录加载失败"
            desc="已有任务不会受影响，可稍后重试。"
            detail={error}
            onRetry={onRetry}
          />
        ) : tasks.length === 0 ? (
          <div className="redraw-history-empty">{emptyText}</div>
        ) : (
          <div className="redraw-history-grid">
            {tasks.map((task) => {
              const fullSrc = assetSrc(task.outputAsset) ?? '';
              // 卡片只显示缩略图; 预览器 / 复用下载仍用完整地址
              const src = assetThumbSrc(task.outputAsset, 480) ?? fullSrc;
              const busy = reusingId === task.id;
              const extension =
                (task.outputAsset?.format || 'png')
                  .split('/')
                  .pop()
                  ?.replace('jpeg', 'jpg')
                  .replace(/\+.*$/, '') || 'png';
              return (
                <article key={task.id} className="redraw-history-card tool-history-card">
                  {fullSrc ? (
                    <button
                      type="button"
                      className="tool-history-preview"
                      aria-label="预览历史结果"
                      title="预览"
                      onClick={() => setPreviewUrl(fullSrc)}
                    >
                      <img src={src} alt="历史生成结果" loading="lazy" />
                      <span className="tool-history-preview-icon" aria-hidden="true">
                        <Maximize2 size={14} />
                      </span>
                    </button>
                  ) : (
                    <div className="tool-history-missing">
                      <ImageOff size={18} />
                    </div>
                  )}
                  <div className="tool-history-meta">
                    <span>
                      {task.createdAt ? new Date(task.createdAt).toLocaleString() : '已生成'}
                    </span>
                    <span
                      style={{ display: 'block', fontSize: 11, color: 'var(--text-desc)' }}
                      title="按任务创建时的价格快照，不随改价变化"
                    >
                      {[
                        task.logicalModelId ? modelNames.get(task.logicalModelId) || '自定义模型' : '',
                        typeof task.creditCost === 'number'
                          ? task.creditCost === 0
                            ? '限时免费'
                            : `${task.creditCost} 积分`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {fullSrc && (
                      <span className="tool-history-meta-actions">
                        {trailing?.reuseTask && (
                          <button
                            type="button"
                            className={`tool-history-action${busy ? ' is-busy' : ''}`}
                            disabled={Boolean(reusingId)}
                            aria-label="使用历史结果继续创作"
                            title="使用此图继续"
                            onClick={() => void reuse(task)}
                          >
                            <RefreshCw size={13} />
                          </button>
                        )}
                        <a
                          href={fullSrc}
                          download={`history-${task.id.slice(-6)}.${extension}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="下载历史结果"
                        >
                          <Download size={13} />
                        </a>
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {previewIndex >= 0 && (
        <ImageLightbox
          items={previewItems}
          index={previewIndex}
          onIndexChange={(index) => setPreviewUrl(previewItems[index]?.url ?? null)}
          onClose={() => setPreviewUrl(null)}
        />
      )}
    </>
  );
}

export function ToolHistoryPane({
  capability,
  refreshKey,
  title = '历史记录',
  emptyText = '暂无记录',
}: {
  capability: string;
  refreshKey?: unknown;
  title?: string;
  emptyText?: string;
}) {
  const { tasks, loading, error, retry } = useToolHistory(capability, refreshKey);
  const trailing = useContext(ToolTrailingContext);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const content = (
    <ToolHistoryGrid
      tasks={tasks}
      loading={loading}
      error={error}
      emptyText={emptyText}
      onRetry={retry}
    />
  );

  return (
    <>
      {!trailing?.collapsed && (
        <aside className="redraw-history-pane" aria-label={title}>
          <div className="redraw-history-head">
            <h2>{title}</h2>
            <div className="tool-history-head-actions">
              {tasks.length > 0 && <span className="tool-history-count">{tasks.length}</span>}
              {trailing && (
                <button
                  type="button"
                  className="redraw-history-collapse"
                  aria-label="收起历史记录"
                  title="收起历史记录"
                  onClick={trailing.toggle}
                >
                  <ChevronUp size={16} />
                </button>
              )}
            </div>
          </div>
          {content}
        </aside>
      )}

      <button
        type="button"
        className="tool-history-float-toggle"
        aria-label="展开历史记录"
        title="展开历史记录"
        onClick={() => {
          // 窄屏没有常驻右栏（CSS 已隐藏），浮动按钮改为打开抽屉。
          if (window.matchMedia('(max-width: 1180px)').matches) setDrawerOpen(true);
          else trailing?.toggle();
        }}
      >
        <History size={18} />
      </button>

      <Drawer
        title={title}
        open={drawerOpen}
        placement="right"
        size={320}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 12 } }}
      >
        {content}
      </Drawer>
    </>
  );
}

/**
 * 前台模型 id → 名称。
 *
 * 历史任务只存 id；名称取自目录（5s 短 TTL，已加载时同步可用，不闪空）。
 * 目录拉取失败时保留空 Map —— 卡片回落显示「自定义模型」，不阻塞历史列表。
 */
function useModelNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(
    () => new Map(modelsSync().map((model) => [model.id, model.name])),
  );

  useEffect(() => {
    let alive = true;
    void loadModels()
      .then((list) => {
        if (alive) setNames(new Map(list.map((model) => [model.id, model.name])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return names;
}
