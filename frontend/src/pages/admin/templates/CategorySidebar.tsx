import { Pencil, Plus } from 'lucide-react';

import { ActionButton, Panel, RowMenu } from '~/admin-ui/primitives';
import type {
  AdminTemplateCategory,
  AdminTemplateGroup,
} from '../../../types/api';

export interface CategorySidebarProps {
  categories: AdminTemplateCategory[];
  categoryId: string | null;
  groupId: string | null;
  totalItems: number;
  writable: boolean;
  onSelectAll: () => void;
  onSelectCategory: (categoryId: string) => void;
  onSelectGroup: (categoryId: string, groupId: string) => void;
  onCreateCategory: () => void;
  onEditCategory: (category: AdminTemplateCategory) => void;
  onDeleteCategory: (category: AdminTemplateCategory) => void;
  onCreateGroup: () => void;
  onEditGroup: (group: AdminTemplateGroup) => void;
  onDeleteGroup: (group: AdminTemplateGroup) => void;
}

/**
 * 后台写真模板左栏：一级分类 + 选中分类下的二级分类。
 *
 * 只负责目录展示与选择；新建/编辑/删除由页面接管（需要弹窗与接口调用）。
 */
export function CategorySidebar({
  categories,
  categoryId,
  groupId,
  totalItems,
  writable,
  onSelectAll,
  onSelectCategory,
  onSelectGroup,
  onCreateCategory,
  onEditCategory,
  onDeleteCategory,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
}: CategorySidebarProps) {
  return (
    <Panel
      title="分类目录"
      note={`${categories.length} 个一级分类`}
      extra={
        writable && (
          <ActionButton size="xs" icon={Plus} onClick={onCreateCategory}>
            新建
          </ActionButton>
        )
      }
    >
      <div className="max-h-[calc(100vh-230px)] overflow-y-auto p-2">
        <button
          type="button"
          onClick={onSelectAll}
          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors ${
            !categoryId ? 'bg-muted' : 'hover:bg-muted/50'
          }`}
        >
          <span className="text-[13px] font-semibold text-foreground">全部模板</span>
          <span className="text-[12px] text-muted-foreground">{totalItems}</span>
        </button>

        <div className="my-1 border-t border-border" />

        {categories.map((category) => {
          const active = category.id === categoryId;
          const itemCount = category.groups.reduce(
            (sum, group) => sum + group.itemCount,
            0,
          );
          return (
            <div key={category.id} className="mb-1">
              <div
                className={`flex items-center gap-1 rounded-md px-2 py-2 transition-colors ${
                  active ? 'bg-muted' : 'hover:bg-muted/50'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelectCategory(category.id)}
                >
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-[13px] text-foreground">
                      {category.name}
                    </strong>
                    {!category.enabled && (
                      <span className="shrink-0 rounded bg-muted px-1 text-[12px] text-muted-foreground">
                        停用
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    {category.groups.length} 个分组 · {itemCount} 套
                  </div>
                </button>
                {writable && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <ActionButton
                      variant="ghost"
                      size="xs"
                      icon={Pencil}
                      ariaLabel={`编辑分类${category.name}`}
                      onClick={() => onEditCategory(category)}
                    />
                    <RowMenu
                      label={`更多操作：${category.name}`}
                      items={[
                        {
                          key: 'delete',
                          label: '删除分类',
                          danger: true,
                          onSelect: () => onDeleteCategory(category),
                        },
                      ]}
                    />
                  </div>
                )}
              </div>

              {active && (
                <div className="ml-3 border-l border-border pl-2">
                  {category.groups.length === 0 && (
                    <p className="px-2 py-1 text-[12px] text-muted-foreground">
                      暂无二级分类
                    </p>
                  )}
                  {category.groups.map((group) => (
                    <div
                      key={group.id}
                      className={`flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors ${
                        groupId === group.id ? 'bg-muted' : 'hover:bg-muted/50'
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onSelectGroup(category.id, group.id)}
                      >
                        <span className="text-[12px] text-foreground">{group.name}</span>
                        <span className="ml-2 text-[12px] text-muted-foreground">
                          {group.itemCount}
                        </span>
                      </button>
                      {writable && (
                        <RowMenu
                          label={`更多操作：${group.name}`}
                          items={[
                            {
                              key: 'edit',
                              label: '编辑分组',
                              onSelect: () => onEditGroup(group),
                            },
                            {
                              key: 'delete',
                              label: '删除分组',
                              danger: true,
                              separator: true,
                              onSelect: () => onDeleteGroup(group),
                            },
                          ]}
                        />
                      )}
                    </div>
                  ))}
                  {writable && (
                    <button
                      type="button"
                      className="mt-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      onClick={onCreateGroup}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      新建二级分类
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
