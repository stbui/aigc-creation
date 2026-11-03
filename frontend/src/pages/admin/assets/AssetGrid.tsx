import { Eye, EyeOff, Maximize2, Trash2 } from 'lucide-react';
import {
  ActionButton,
  CheckboxField,
  EmptyState,
  IconButton,
  ListError,
  Pagination,
  SkeletonBody,
} from '~/admin-ui/primitives';
import { AssetThumb } from './AssetThumb';
import { assetLabel, cn, fmtBytes, fmtFormat, thumbSrc } from './utils';
import type { AssetRow } from './constants';
import type { AssetStatus } from '../../../types/api';

/**
 * 缩略图网格视图。
 *
 * 网格用来「扫图」：一页 60 张，勾选直接叠在缩略图左上角，悬停出快捷动作。
 * 空态 / 加载 / 失败在本组件内收口，页面只负责取数与写操作。
 */
export function AssetGrid({
  items,
  loading,
  error,
  page,
  pageSize,
  total,
  selected,
  selectable,
  statusBusyId,
  canHide,
  canDelete,
  hasFilter,
  onRetry,
  onResetFilters,
  onToggleSelected,
  onPreview,
  onToggleStatus,
  onDelete,
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
  statusBusyId: string | null;
  canHide: boolean;
  canDelete: boolean;
  hasFilter: boolean;
  onRetry: () => void;
  onResetFilters: () => void;
  onToggleSelected: (id: string, checked: boolean) => void;
  onPreview: (id: string) => void;
  onToggleStatus: (row: AssetRow, next: AssetStatus) => void;
  onDelete: (row: AssetRow) => void;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && items.length === 0) {
    /* 面板外壳已经是实的，只替内容行 */
    return <SkeletonBody rows={4} />;
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
        className={cn(
          'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]',
          loading && 'opacity-60',
        )}
        aria-busy={loading}
      >
        {items.map((a) => {
          const checked = selected.includes(a.id);
          return (
            <article
              key={a.id}
              data-testid="admin-asset-cell"
              data-status={a.status}
              className={cn(
                'group overflow-hidden rounded-xl border bg-card transition-colors',
                checked ? 'border-brand ring-1 ring-brand/20' : 'border-border',
                a.status === 'hidden' && 'opacity-75',
              )}
            >
              <div className="relative aspect-square">
                <button
                  type="button"
                  className="block size-full"
                  aria-label={`查看大图：${assetLabel(a)}`}
                  onClick={() => onPreview(a.id)}
                >
                  <AssetThumb
                    className="size-full"
                    src={thumbSrc(a.sourceUrl, 320)}
                    alt={`${assetLabel(a)}缩略图`}
                  />
                </button>

                {selectable && (
                  <span className="absolute left-2 top-2 flex size-5 items-center justify-center rounded bg-card/90 shadow-xs">
                    <CheckboxField
                      ariaLabel={`选择 ${assetLabel(a)}`}
                      checked={checked}
                      onChange={(next) => onToggleSelected(a.id, next)}
                    />
                  </span>
                )}

                {a.status === 'hidden' && (
                  <span className="absolute right-2 top-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[12px] text-background">
                    已下架
                  </span>
                )}

                <div
                  className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-foreground/55 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  role="group"
                  aria-label="素材快捷操作"
                >
                  <IconButton
                    size="sm"
                    icon={Maximize2}
                    label={`查看大图：${assetLabel(a)}`}
                    title="查看大图"
                    onClick={() => onPreview(a.id)}
                  />
                  {canHide && (
                    <IconButton
                      size="sm"
                      icon={a.status === 'visible' ? EyeOff : Eye}
                      label={a.status === 'visible' ? '下架素材' : '恢复上架'}
                      title={a.status === 'visible' ? '下架素材' : '恢复上架'}
                      disabled={statusBusyId === a.id}
                      onClick={() =>
                        onToggleStatus(a, a.status === 'visible' ? 'hidden' : 'visible')
                      }
                    />
                  )}
                  {canDelete && (
                    <IconButton
                      size="sm"
                      icon={Trash2}
                      label="永久删除素材"
                      title="永久删除"
                      className="text-danger-text hover:text-danger-text"
                      onClick={() => onDelete(a)}
                    />
                  )}
                </div>
              </div>

              <div className="px-2 py-1.5">
                <div className="truncate text-xs font-medium text-foreground" title={assetLabel(a)}>
                  {assetLabel(a)}
                </div>
                <div
                  className="truncate text-[12px] text-muted-foreground"
                  title={`${fmtFormat(a.format)}${
                    a.width && a.height ? ` · ${a.width}×${a.height}` : ''
                  } · ${fmtBytes(a.sizeBytes)}`}
                >
                  {fmtFormat(a.format)}
                  {a.width && a.height ? ` · ${a.width}×${a.height}` : ''} ·{' '}
                  {fmtBytes(a.sizeBytes)}
                </div>
                <div
                  className="truncate text-[12px] text-muted-foreground"
                  title={`${a.ownerEmail} · ${a.projectName}`}
                >
                  {a.ownerEmail} · {a.projectName}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {total > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">共 {total} 张</span>
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
