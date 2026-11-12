import { useEffect, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Trash2, X } from 'lucide-react';

import {
  ActionButton,
  Badge,
  Pagination,
  Panel,
  SegmentedGroup,
  TextField,
  Toggle,
} from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';
import type { AdminTemplateItem } from '../../../types/api';

export type StatusFilter = 'all' | 'enabled' | 'disabled';

/**
 * 卡片网格每页条数。
 *
 * 目录可达 550 套以上，一次性铺满会让首屏同时解码几百张预览图；
 * 固定 50 套（5 列 10 行 / 4 列约 13 行）兼顾浏览密度与渲染开销。
 */
const PAGE_SIZE = 50;

export interface TemplateWorkspaceProps {
  title: string;
  items: AdminTemplateItem[];
  groupNameById: Map<string, string>;
  search: string;
  statusFilter: StatusFilter;
  tagFilter: string | null;
  emptyTitle: string;
  emptyDesc: string;
  writable: boolean;
  /** 选中一级分类但未选二级分类时，显示「新建二级分类」 */
  canCreateGroup: boolean;
  /** 选中二级分类时，显示「新建模板」 */
  canCreateItem: boolean;
  /** 当前按分组过滤时不再重复显示分组名 */
  showGroupName: boolean;
  /** 目录位置标识（一级 / 二级分类）；变化时回到第一页 */
  scopeKey: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onTagFilter: (tag: string | null) => void;
  onClearFilters: () => void;
  onCreateGroup: () => void;
  onCreateItem: () => void;
  onPreview: (item: AdminTemplateItem) => void;
  onEdit: (item: AdminTemplateItem) => void;
  onCopy: (item: AdminTemplateItem) => void;
  onDelete: (item: AdminTemplateItem) => void;
  /** 点击卡片上的分组名：左侧目录跳转到该分组 */
  onGroupClick: (groupId: string) => void;
}

/**
 * 后台写真模板右栏：搜索 / 状态筛选 / 模板卡片网格。
 *
 * 卡片只负责展示与触发回调；新建、编辑、删除与预览弹窗都在页面层。
 */
export function TemplateWorkspace({
  title,
  items,
  groupNameById,
  search,
  statusFilter,
  tagFilter,
  emptyTitle,
  emptyDesc,
  writable,
  canCreateGroup,
  canCreateItem,
  showGroupName,
  scopeKey,
  onSearchChange,
  onStatusChange,
  onTagFilter,
  onClearFilters,
  onCreateGroup,
  onCreateItem,
  onPreview,
  onEdit,
  onCopy,
  onDelete,
  onGroupClick,
}: TemplateWorkspaceProps) {
  const [page, setPage] = useState(1);

  // 只有筛选条件或目录位置变化才回到第一页；reload 只是数据更新，
  // 删除/编辑后留在当前页，避免页码被重置到 1 打断连续操作。
  useEffect(() => {
    setPage(1);
  }, [scopeKey, search, statusFilter, tagFilter]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  // 删除最后一页的条目后 totalPages 会变小，页码需要跟着收敛。
  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);
  const pagedItems = useMemo(
    () => items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [items, currentPage],
  );
  const rangeStart = items.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, items.length);

  return (
    <Panel
      title={title}
      note={`${items.length} 套`}
      extra={
        <div className="flex items-center gap-2">
          {canCreateGroup && writable && (
            <ActionButton variant="outline" size="sm" icon={Plus} onClick={onCreateGroup}>
              新建二级分类
            </ActionButton>
          )}
          {canCreateItem && writable && (
            <ActionButton size="sm" icon={Plus} onClick={onCreateItem}>
              新建模板
            </ActionButton>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <TextField
          value={search}
          onChange={onSearchChange}
          placeholder="名称 / 标签 / 提示词"
          ariaLabel="搜索模板"
          className="w-[260px]"
        />
        <SegmentedGroup
          value={statusFilter}
          onChange={(value) => onStatusChange(value as StatusFilter)}
          options={[
            { value: 'all', label: '全部' },
            { value: 'enabled', label: '启用' },
            { value: 'disabled', label: '停用' },
          ]}
          ariaLabel="按启用状态筛选"
        />
        {tagFilter && (
          <Badge
            variant="outline"
            asChild
            className="gap-1 rounded-full border-brand bg-brand-bg py-1 text-[12px] font-normal text-brand"
          >
            <button
              type="button"
              onClick={() => onTagFilter(null)}
              aria-label={`清除标签筛选${tagFilter}`}
            >
              标签：{tagFilter}
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        )}
        {(search || statusFilter !== 'all' || tagFilter) && (
          <ActionButton variant="ghost" size="xs" onClick={onClearFilters}>
            清除筛选
          </ActionButton>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-14 text-center">
          <p className="text-[13px] font-medium text-foreground">{emptyTitle}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{emptyDesc}</p>
        </div>
      ) : (
        <div className="grid auto-rows-fr grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {pagedItems.map((item) => (
            <article
              key={item.id}
              className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card"
            >
              <button
                type="button"
                className="relative block aspect-[4/3] w-full overflow-hidden bg-muted"
                onClick={() => onPreview(item)}
                aria-label={`预览模板${item.name}`}
                title="查看大图与提示词"
              >
                {item.thumbFile ? (
                  <img
                    src={item.thumbFile}
                    alt={`${item.name}预览`}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                    暂无图片
                  </span>
                )}
                {!item.enabled && (
                  <span className="absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[12px] text-muted-foreground">
                    已停用
                  </span>
                )}
              </button>

              <div className="flex flex-1 flex-col gap-2 p-3">
                <strong className="min-w-0 truncate text-[13px] text-foreground">
                  {item.name}
                </strong>

                {/* 分组与标签同一行；分组可点，直接跳到左侧对应二级分类 */}
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {showGroupName && (
                    <button
                      type="button"
                      onClick={() => onGroupClick(item.groupId)}
                      className="shrink-0 rounded-full border border-brand/40 bg-brand-bg px-1.5 py-0.5 text-[12px] leading-4 text-brand transition-colors hover:border-brand"
                      aria-label={`只看分组${groupNameById.get(item.groupId) ?? ''}`}
                      title="只看该分组"
                    >
                      {groupNameById.get(item.groupId) ?? ''}
                    </button>
                  )}
                  {item.tags.slice(0, 4).map((tag) => {
                    const active = tag === tagFilter;
                    return (
                      <Toggle
                        key={tag}
                        variant="outline"
                        size="sm"
                        pressed={active}
                        onPressedChange={() => onTagFilter(active ? null : tag)}
                        title={`按标签「${tag}」筛选`}
                        className={cn(
                          'h-auto min-w-0 shrink-0 gap-1 rounded-full border-border bg-muted/50 px-1.5 py-0.5 text-[12px] leading-4 font-normal shadow-none',
                          'text-muted-foreground hover:border-brand hover:bg-muted/50 hover:text-brand',
                          'data-[state=on]:border-brand data-[state=on]:bg-brand-bg data-[state=on]:text-brand',
                          'data-[state=on]:hover:bg-brand-bg data-[state=on]:hover:text-brand',
                        )}
                      >
                        {tag}
                      </Toggle>
                    );
                  })}
                  {item.tags.length > 4 && (
                    <span className="shrink-0 rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[12px] leading-4 text-muted-foreground">
                      +{item.tags.length - 4}
                    </span>
                  )}
                </div>

                <p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                  {item.prompt}
                </p>

                {writable && (
                  <div className="mt-auto flex items-center gap-0.5 border-t border-border pt-1.5">
                    <ActionButton
                      variant="ghost"
                      size="xs"
                      icon={Pencil}
                      className="flex-1 gap-1 px-1 text-[12px] [&_svg]:size-3"
                      ariaLabel={`编辑模板${item.name}`}
                      onClick={() => onEdit(item)}
                    >
                      编辑
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      size="xs"
                      icon={Copy}
                      className="flex-1 gap-1 px-1 text-[12px] [&_svg]:size-3"
                      ariaLabel={`复制模板${item.name}`}
                      onClick={() => onCopy(item)}
                    >
                      复制
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      size="xs"
                      icon={Trash2}
                      className="flex-1 gap-1 px-1 text-[12px] text-danger-text hover:bg-danger-soft hover:text-danger-text [&_svg]:size-3"
                      ariaLabel={`删除模板${item.name}`}
                      onClick={() => onDelete(item)}
                    >
                      删除
                    </ActionButton>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2"
          data-testid="admin-template-pagination"
        >
          <span className="text-[12px] text-muted-foreground">
            第 {rangeStart}–{rangeEnd} 套
          </span>
          <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </Panel>
  );
}
