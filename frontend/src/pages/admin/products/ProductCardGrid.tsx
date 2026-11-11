import {
  ActionButton,
  EmptyState,
  ListError,
  Pagination,
  SelectField,
  SkeletonCards,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { ProductCard } from './ProductCard';
import type { AdminProduct } from '../../../types/api';

interface ProductCardGridProps {
  rows: AdminProduct[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  writable: boolean;
  /** 有 `product.delete` 才出现删除按钮；有历史订单时由页面拦下并提示改为下架 */
  deletable: boolean;
  saving: boolean;
  filtered: boolean;
  onClearFilter: () => void;
  onCreate: () => void;
  onEdit: (row: AdminProduct) => void;
  onToggle: (row: AdminProduct) => void;
  onDelete: (row: AdminProduct) => void;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

const PAGE_SIZE_OPTIONS = [20, 50, 100].map((size) => ({
  value: String(size),
  label: String(size),
}));

/** 商品卡片列表：一张卡片对应一个商品，保留列表的加载、空态与分页。 */
export function ProductCardGrid({
  rows,
  loading,
  error,
  onRetry,
  writable,
  deletable,
  saving,
  filtered,
  onClearFilter,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
  pagination,
}: ProductCardGridProps) {
  if (loading && rows.length === 0) {
    return (
      <SkeletonCards
        count={8}
        className="mt-0"
        gridClassName="grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
      />
    );
  }

  if (error && rows.length === 0) {
    return <ListError error={error} onRetry={onRetry} />;
  }

  if (!loading && !error && rows.length === 0) {
    return (
      <EmptyState
        title={
          filtered
            ? '当前筛选下没有商品。换个关键词或清除筛选看看。'
            : '还没有商品。新建一个积分包，C 端结算页才会出现可购买项。'
        }
        action={
          filtered ? (
            <ActionButton variant="secondary" size="sm" onClick={onClearFilter}>
              清除筛选
            </ActionButton>
          ) : writable ? (
            <ActionButton size="sm" onClick={onCreate}>
              新建商品
            </ActionButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div
        data-testid="admin-product-grid"
        aria-busy={loading}
        className={cn(
          'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4',
          loading && 'opacity-60',
        )}
      >
        {rows.map((row) => (
          <ProductCard
            key={row.id}
            row={row}
            writable={writable}
            deletable={deletable}
            saving={saving}
            onEdit={() => onEdit(row)}
            onToggle={() => onToggle(row)}
            onDelete={() => onDelete(row)}
          />
        ))}
      </div>

      {pagination.total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            共 {pagination.total} 个商品
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              每页
              <SelectField
                className="w-[72px]"
                ariaLabel="每页条数"
                value={String(pagination.pageSize)}
                onChange={(next) => {
                  if (next) pagination.onChange(1, Number(next));
                }}
                options={PAGE_SIZE_OPTIONS}
              />
            </div>
            <Pagination
              page={pagination.current}
              totalPages={Math.max(
                1,
                Math.ceil(pagination.total / pagination.pageSize),
              )}
              onChange={(page) =>
                pagination.onChange(page, pagination.pageSize)
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
