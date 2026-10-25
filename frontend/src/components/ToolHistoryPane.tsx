import { useContext, useEffect, useState } from 'react';
import { Drawer, Spin } from 'antd';
import { ChevronUp, Download, History, ImageOff, Maximize2 } from 'lucide-react';
import { assetSrc, generateApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ImageLightbox } from './ImageLightbox';
import { ToolTrailingContext } from './ToolShell';
import { StateError } from './StateViews';

/**
 * 修图工具的通用历史侧栏。
 *
 * 参考站各修图页右侧都有结果历史；此前本地只有局部重绘实现了它。
 * 这里统一按能力过滤真实任务，刷新键通常是当前结果 URL：新任务完成时
 * 页面拿到的 result 变化，历史随即重新拉取。加载中与空列表分开显示，
 * 避免网络尚未返回时先给出「暂无记录」的错误结论。
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
      .list()
      .then((items) => {
        if (cancelled) return;
        setTasks(
          items
            .filter((task) => task.capability === capability && task.status === 'succeeded' && task.outputAsset)
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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

  const content = (
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
          onRetry={retry}
        />
      ) : tasks.length === 0 ? (
        <div className="redraw-history-empty">{emptyText}</div>
      ) : (
        <div className="redraw-history-grid">
          {tasks.map((task) => {
            const src = assetSrc(task.outputAsset) ?? '';
            return (
              <article key={task.id} className="redraw-history-card tool-history-card">
                {src ? (
                  <button
                    type="button"
                    className="tool-history-preview"
                    aria-label="预览历史结果"
                    title="预览"
                    onClick={() => setPreviewUrl(src)}
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
                  <span>{task.createdAt ? new Date(task.createdAt).toLocaleString() : '已生成'}</span>
                  {src && (
                    <a href={src} download target="_blank" rel="noreferrer" aria-label="下载历史结果">
                      <Download size={13} />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
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
