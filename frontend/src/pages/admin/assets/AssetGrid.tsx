import { useRef, useState } from 'react';
import {
  ActionButton,
  CheckboxField,
  EmptyState,
  ListError,
  Pagination,
} from '~/admin-ui/primitives';
import { AssetThumb } from './AssetThumb';
import { assetLabel, cn, fmtBytes, generationLine, thumbSrc } from './utils';
import type { AssetRow } from './constants';

/**
 * 缩略图网格视图。
 *
 * 网格用来「扫图」：一页 60 张，勾选直接叠在缩略图左上角，点图打开大图预览，
 * 在网格上拖拽可框选（默认替换选择，按住 Ctrl / Cmd / Shift 累加）；
 * 图片不加圆角，避免裁掉画面四角影响判断。单张下架 / 删除在大图预览里操作。
 * 空态 / 加载 / 失败在本组件内收口，页面只负责取数与写操作。
 */
/** 指针移动超过这个距离才视为框选，否则仍按「点击看大图」处理 */
const MARQUEE_THRESHOLD = 4;

/** 框选结束后短暂屏蔽点击，避免松手时顺带打开最后一张大图 */
const MARQUEE_CLICK_GUARD_MS = 150;

export function AssetGrid({
  items,
  loading,
  error,
  page,
  pageSize,
  total,
  selected,
  selectable,
  hasFilter,
  onRetry,
  onResetFilters,
  onToggleSelected,
  onSelectMany,
  onPreview,
  onPageChange,
}: {
  items: AssetRow[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number;
  selected: string[];
  selectable: boolean;
  hasFilter: boolean;
  onRetry: () => void;
  onResetFilters: () => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  onSelectMany: (ids: string[]) => void;
  onPreview: (id: string) => void;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** 框选矩形（相对网格容器）；null 表示当前没有在框选 */
  const gridRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeEndedAtRef = useRef(0);

  /**
   * 鼠标框选：在网格上按下并拖动，框到的卡片即成为选中项。
   *
   * 默认**替换**当前选择（和文件管理器一致，框出去就取消选中）；按住
   * Ctrl / Cmd / Shift 拖拽则在已有选择上**累加**。事件挂在 window 上，
   * 指针移出网格甚至移出窗口再松手也能正确收尾。
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectable || event.button !== 0) return;
    // 复选框有自己的交互，不参与框选
    if ((event.target as HTMLElement).closest('[data-marquee-ignore]')) return;
    const grid = gridRef.current;
    if (!grid) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const base = additive ? [...selected] : [];
    /** 首次绘制一定触发一次同步（非累加时顺带清空旧选择） */
    let lastKey: string | null = null;
    let moved = false;
    /** 指针移动频率远高于渲染帧率，按帧合并，避免整屏卡片每个 move 都重渲染 */
    let frame = 0;
    let pending: PointerEvent | null = null;

    const paint = () => {
      frame = 0;
      if (!pending) return;
      const moveEvent = pending;

      const gridRect = grid.getBoundingClientRect();
      setMarquee({
        left: Math.min(startX, moveEvent.clientX) - gridRect.left,
        top: Math.min(startY, moveEvent.clientY) - gridRect.top,
        width: Math.abs(moveEvent.clientX - startX),
        height: Math.abs(moveEvent.clientY - startY),
      });

      const hitLeft = Math.min(startX, moveEvent.clientX);
      const hitRight = Math.max(startX, moveEvent.clientX);
      const hitTop = Math.min(startY, moveEvent.clientY);
      const hitBottom = Math.max(startY, moveEvent.clientY);

      const hits: string[] = [];
      grid.querySelectorAll<HTMLElement>('[data-asset-id]').forEach((cell) => {
        const id = cell.dataset.assetId;
        if (!id) return;
        const rect = cell.getBoundingClientRect();
        // 与框选矩形有交集即选中（部分压到也算），和文件管理器的习惯一致
        if (
          rect.left < hitRight &&
          rect.right > hitLeft &&
          rect.top < hitBottom &&
          rect.bottom > hitTop
        ) {
          hits.push(id);
        }
      });

      const next = additive ? Array.from(new Set([...base, ...hits])) : hits;
      const key = next.join('\u0001');
      if (key !== lastKey) {
        lastKey = key;
        onSelectMany(next);
      }
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (
        !moved &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < MARQUEE_THRESHOLD
      ) {
        return;
      }
      moved = true;
      pending = moveEvent;
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    const finish = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        // 松手前最后一帧可能还没画：补算一次，避免漏选最后划过的卡片
        paint();
      }
      setMarquee(null);
      if (moved) marqueeEndedAtRef.current = Date.now();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  if (loading && items.length === 0) {
    /* 面板外壳已经是实的，只替内容行；骨架保持网格形态，避免首屏塌成几条灰线 */
    return (
      <div
        className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]"
        aria-busy="true"
        aria-live="polite"
      >
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="overflow-hidden border border-border bg-card">
            <div className="aspect-square animate-pulse bg-accent" />
            <div className="space-y-1.5 px-2 pb-2 pt-1.5">
              <div className="h-3 w-2/3 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-accent" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-accent" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (error && items.length === 0) {
    return <ListError error={error} onRetry={onRetry} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={hasFilter ? '没有符合条件的素材' : '暂无素材'}
        description={
          hasFilter
            ? '没有符合当前筛选条件的素材。清除筛选后可查看全部素材。'
            : '暂无素材。用户上传或生成图片后，会在这里出现。'
        }
        action={
          hasFilter ? (
            <ActionButton variant="secondary" onClick={onResetFilters}>
              清除筛选
            </ActionButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div
        ref={gridRef}
        className={cn(
          'relative grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]',
          loading && 'opacity-60',
          selectable && 'select-none',
        )}
        aria-busy={loading}
        onPointerDown={selectable ? handlePointerDown : undefined}
      >
        {items.map((a) => {
          const checked = selected.includes(a.id);
          return (
            <article
              key={a.id}
              data-testid="admin-asset-cell"
              data-asset-id={a.id}
              data-status={a.status}
              className={cn(
                'group overflow-hidden border bg-card transition-[border-color,box-shadow]',
                checked
                  ? 'border-brand ring-1 ring-brand/20'
                  : 'border-border hover:border-brand/40 hover:shadow-card',
                a.status === 'hidden' && 'opacity-75',
              )}
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <button
                  type="button"
                  className="block size-full focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset focus-visible:outline-none"
                  aria-label={`查看大图：${assetLabel(a)}`}
                  onClick={() => {
                    // 框选松手会补发一次 click，别让它顺手打开最后一张大图
                    if (Date.now() - marqueeEndedAtRef.current < MARQUEE_CLICK_GUARD_MS) return;
                    onPreview(a.id);
                  }}
                >
                  <AssetThumb
                    className="size-full transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transform-none"
                    src={thumbSrc(a.sourceUrl, 320)}
                    alt={`${assetLabel(a)}缩略图`}
                    format={a.format}
                  />
                </button>

                {selectable && (
                  <span
                    data-marquee-ignore
                    className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-md bg-background/90 shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm"
                  >
                    <CheckboxField
                      ariaLabel={`选择 ${assetLabel(a)}`}
                      checked={checked}
                      onChange={(next) => onToggleSelected(a.id, next)}
                    />
                  </span>
                )}

                {a.status === 'hidden' && (
                  <span className="absolute right-2 top-2 rounded-[4px] bg-warn-soft px-1.5 py-0.5 text-[12px] leading-4 font-medium text-warn-text ring-1 ring-warn-border">
                    已下架
                  </span>
                )}
              </div>

              <div className="px-2 pb-2 pt-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-foreground"
                    title={assetLabel(a)}
                  >
                    {assetLabel(a)}
                  </span>
                </div>
                <div className="truncate text-[12px] leading-4 text-muted-foreground tabular-nums">
                  {fmtBytes(a.sizeBytes)}
                </div>
                {a.generation && (
                  <div
                    className="truncate text-[12px] leading-4 text-muted-foreground"
                    title={generationLine(a.generation)}
                  >
                    {generationLine(a.generation)}
                  </div>
                )}
                <div
                  className="truncate text-[12px] leading-4 text-muted-foreground"
                  title={`${a.ownerEmail} · ${a.projectName}`}
                >
                  {a.ownerEmail} · {a.projectName}
                </div>
              </div>
            </article>
          );
        })}

        {marquee && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20 border border-brand bg-brand/10"
            style={marquee}
          />
        )}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
          <Pagination
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            // 翻页必须清空选择：否则会对看不见的行执行批量下架/删除
            onChange={onPageChange}
            previousLabel="上一页"
            nextLabel="下一页"
            aria-label="分页"
          />
        </div>
      )}
    </>
  );
}
