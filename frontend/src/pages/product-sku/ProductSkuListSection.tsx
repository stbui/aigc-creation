import { Plus } from 'lucide-react';

import { MAX_SKUS, type SkuItem } from './constants';
import { Button, type SkuRegion } from './components';
import { ProductSkuListItem } from './ProductSkuListItem';

interface ProductSkuListSectionProps {
  items: SkuItem[];
  regions: SkuRegion[];
  /** 与其它行重名的规范化名称集合（小写） */
  duplicateNames: Set<string>;
  referenceBusy: string | null;
  onAdd: () => void;
  onRemove: (key: number) => void;
  onNameChange: (key: number, name: string) => void;
  onInstructionChange: (itemKey: number, regionId: string, instruction: string) => void;
  onUploadReference: (
    file: File | undefined,
    itemKey: number,
    regionId: string,
    input: HTMLInputElement,
  ) => void;
  onOpenReferenceLibrary: (itemKey: number, regionId: string) => void;
  onOpenReferenceMobile: (itemKey: number, regionId: string) => void;
  onRemoveReference: (itemKey: number, regionId: string) => void;
  onPreview: (url: string) => void;
}

/**
 * SKU 清单编辑器：标题栏 + 添加按钮 + 逐行 SKU。
 *
 * 行内状态由 `ProductSkuListItem` / `ProductSkuVariantRow` 展示，
 * 增删与字段更新全部回到页面的 `items` 状态。
 */
export function ProductSkuListSection({
  items,
  regions,
  duplicateNames,
  referenceBusy,
  onAdd,
  onRemove,
  onNameChange,
  onInstructionChange,
  onUploadReference,
  onOpenReferenceLibrary,
  onOpenReferenceMobile,
  onRemoveReference,
  onPreview,
}: ProductSkuListSectionProps) {
  return (
    <section className="product-sku-list-section" aria-label="SKU 清单">
      <div className="product-sku-list-heading">
        <strong>SKU 清单</strong>
        <Button
          htmlType="button"
          variant="ghost"
          size="xs"
          disabled={items.length >= MAX_SKUS}
          className="h-auto text-brand hover:bg-transparent"
          onClick={onAdd}
        >
          <Plus className="size-3" /> 添加 SKU
        </Button>
      </div>

      {items.map((item, itemIndex) => (
        <ProductSkuListItem
          key={item.key}
          item={item}
          itemIndex={itemIndex}
          regions={regions}
          duplicate={duplicateNames.has(item.name.trim().toLowerCase())}
          canRemove={items.length > 1}
          referenceBusy={referenceBusy}
          onNameChange={onNameChange}
          onRemove={onRemove}
          onInstructionChange={onInstructionChange}
          onUploadReference={onUploadReference}
          onOpenReferenceLibrary={onOpenReferenceLibrary}
          onOpenReferenceMobile={onOpenReferenceMobile}
          onRemoveReference={onRemoveReference}
          onPreview={onPreview}
        />
      ))}
    </section>
  );
}
