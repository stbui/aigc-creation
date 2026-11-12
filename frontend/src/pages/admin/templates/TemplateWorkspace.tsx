import { Pencil, Plus, X } from 'lucide-react';

import {
  ActionButton,
  Badge,
  Panel,
  RowMenu,
  SegmentedGroup,
  TextField,
  Toggle,
} from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';
import type { AdminTemplateItem } from '../../../types/api';

export type StatusFilter = 'all' | 'enabled' | 'disabled';

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
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onTagFilter: (tag: string | null) => void;
  onClearFilters: () => void;
  onCreateGroup: () => void;
  onCreateItem: () => void;
  onPreview: (item: AdminTemplateItem) => void;
  onEdit: (item: AdminTemplateItem) => void;
  onDelete: (item: AdminTemplateItem) => void;
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
  onSearchChange,
  onStatusChange,
  onTagFilter,
  onClearFilters,
  onCreateGroup,
  onCreateItem,
  onPreview,
  onEdit,
  onDelete,
}: TemplateWorkspaceProps) {
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
        <span className="ml-auto text-[12px] text-muted-foreground">
          共 {items.length} 套
        </span>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-14 text-center">
          <p className="text-[13px] font-medium text-foreground">{emptyTitle}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{emptyDesc}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card"
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
                <div className="flex items-start justify-between gap-2">
                  <strong className="min-w-0 truncate text-[13px] text-foreground">
                    {item.name}
                  </strong>
                  {writable && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <ActionButton
                        variant="ghost"
                        size="xs"
                        icon={Pencil}
                        ariaLabel={`编辑模板${item.name}`}
                        onClick={() => onEdit(item)}
                      />
                      <RowMenu
                        label={`更多操作：${item.name}`}
                        items={[
                          {
                            key: 'preview',
                            label: '预览大图',
                            onSelect: () => onPreview(item),
                          },
                          {
                            key: 'delete',
                            label: '删除模板',
                            danger: true,
                            separator: true,
                            onSelect: () => onDelete(item),
                          },
                        ]}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
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
                          'h-auto min-w-0 gap-1 rounded-full border-border bg-muted/50 px-1.5 py-0.5 text-[12px] leading-4 font-normal shadow-none',
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
                    <span className="rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[12px] leading-4 text-muted-foreground">
                      +{item.tags.length - 4}
                    </span>
                  )}
                </div>

                <p className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                  {item.prompt}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[12px] text-muted-foreground">
                  <span className="truncate">
                    {showGroupName ? (groupNameById.get(item.groupId) ?? '') : ''}
                  </span>
                  <span className="shrink-0">排序 {item.sortOrder}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
