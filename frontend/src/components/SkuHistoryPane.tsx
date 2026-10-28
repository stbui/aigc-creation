import { useContext, useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { ChevronRight, ChevronUp, Download, Eye, History, Pencil, Trash2 } from 'lucide-react';
import { ToolTrailingContext } from './ToolShell';
import { groupContainsTask, type SkuBatchGroup } from '../lib/skuBatches';

const PAGE_SIZE = 10;

interface Props {
  items: SkuBatchGroup[];
  loading: boolean;
  error?: string | null;
  activeId?: string | null;
  onOpen: (group: SkuBatchGroup) => void;
  onRestore: (group: SkuBatchGroup) => void;
  onDownload: (group: SkuBatchGroup) => void;
  onDelete: (group: SkuBatchGroup) => void;
  onRetry: () => void;
}

function HistoryList({
  items,
  loading,
  error,
  activeId,
  onOpen,
  onRestore,
  onDownload,
  onDelete,
  onRetry,
}: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisible((count) => Math.max(PAGE_SIZE, Math.min(count, items.length || PAGE_SIZE)));
  }, [items.length]);

  if (loading && items.length === 0) {
    return (
      <div className="redraw-history-loading" aria-live="polite">
        <Spin size="small" />
        <span>加载中…</span>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="product-sku-history-state">
        <span>历史记录加载失败</span>
        <button type="button" onClick={onRetry}>重试</button>
      </div>
    );
  }

  if (items.length === 0) return <div className="redraw-history-empty">暂无历史记录</div>;

  return (
    <div
      className="product-sku-history-list"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80 && visible < items.length) {
          setVisible((count) => Math.min(items.length, count + PAGE_SIZE));
        }
      }}
    >
      {items.slice(0, visible).map((group) => {
        const active = Boolean(activeId && groupContainsTask(group, activeId));
        const name = group.label;
        const cover = group.cover;
        return (
          <article key={group.id} className={`product-sku-history-card${active ? ' is-active' : ''}`}>
            <button
              type="button"
              className="product-sku-history-preview"
              aria-label={`打开 ${name}`}
              title="在结果区打开"
              onClick={() => onOpen(group)}
            >
              {cover?.url ? (
                <img src={cover.url} alt={`${name}历史结果`} loading="lazy" />
              ) : (
                <span className="product-sku-thumb-placeholder" />
              )}
              {group.totalCount > 1 && (
                <span className="product-sku-history-count">
                  {group.items.length < group.totalCount ? `${group.items.length}/${group.totalCount}` : `${group.totalCount} 款`}
                </span>
              )}
              <span className="product-sku-history-preview-mask"><Eye size={15} /></span>
            </button>
            <div className="product-sku-history-meta">
              <strong title={name}>{name}</strong>
              <span>{group.createdAt ? new Date(group.createdAt).toLocaleString() : '已生成'}</span>
            </div>
            <div className="product-sku-history-actions">
              <button type="button" aria-label={`重新编辑 ${name}`} title="重新编辑整批" onClick={() => onRestore(group)}>
                <Pencil size={13} />
              </button>
              <button type="button" aria-label={`下载 ${name}`} title={group.items.length > 1 ? '打包下载整批' : '下载'} onClick={() => onDownload(group)}>
                <Download size={13} />
              </button>
              <button type="button" aria-label={`移除 ${name}`} title="移除" onClick={() => onDelete(group)}>
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        );
      })}
      {visible < items.length && (
        <button type="button" className="product-sku-history-more" onClick={() => setVisible((count) => Math.min(items.length, count + PAGE_SIZE))}>
          加载更多
        </button>
      )}
    </div>
  );
}

export function SkuHistoryPane(props: Props) {
  const trailing = useContext(ToolTrailingContext);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1366px)').matches);
  const [compactOpen, setCompactOpen] = useState(false);
  const lastRestoreRef = useRef(0);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1366px)');
    const onChange = () => {
      setCompact(query.matches);
      if (!query.matches) setCompactOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const content = (
    <HistoryList
      {...props}
      onRestore={(group) => {
        const now = Date.now();
        if (now - lastRestoreRef.current < 500) return;
        lastRestoreRef.current = now;
        props.onRestore(group);
      }}
    />
  );

  return (
    <>
      {(!trailing?.collapsed || compact) && (
        <aside
          className={`product-sku-history${compact ? ' is-compact' : ''}${compactOpen ? ' is-compact-open' : ''}`}
          aria-label="SKU 历史记录"
          aria-hidden={compact && !compactOpen ? true : undefined}
          inert={compact && !compactOpen ? true : undefined}
        >
          <div className="history-title">
            <span>
              <History size={15} />
              历史记录
            </span>
            {trailing && (
              <button
                type="button"
                aria-label="收起历史记录"
                title="收起历史记录"
                onClick={() => {
                  if (compact) setCompactOpen(false);
                  else trailing.toggle();
                }}
              >
                {compact ? <ChevronRight size={16} /> : <ChevronUp size={16} />}
              </button>
            )}
          </div>
          {content}
        </aside>
      )}

      <button
        type="button"
        className="product-sku-history-float-toggle tool-history-float-toggle"
        aria-label={compact ? (compactOpen ? '收起历史记录' : '展开历史记录') : '切换历史记录'}
        title={compact ? (compactOpen ? '收起历史记录' : '展开历史记录') : '切换历史记录'}
        aria-expanded={compact ? compactOpen : !trailing?.collapsed}
        onClick={() => {
          if (compact) setCompactOpen((open) => !open);
          else trailing?.toggle();
        }}
      >
        <History size={18} />
      </button>
    </>
  );
}
