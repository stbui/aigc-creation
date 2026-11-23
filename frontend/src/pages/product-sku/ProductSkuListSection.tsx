import { Plus } from 'lucide-react';

import { MAX_SKUS, type SkuItem } from './constants';
import { type SkuRegion, TextAction } from './components';
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
 * 增删与字段更新全部回到页面的 `items` 状态。标题栏吸顶：清单可以很长，
 * 滚动时「添加 SKU」必须一直在手边。
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
    <section className="grid min-h-0 content-start gap-2.5" aria-label="SKU 清单">
      <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 bg-page px-3 py-0.5">
        <strong className="text-xs font-semibold text-foreground">SKU 清单</strong>
        <TextAction
          icon={<Plus size={12} aria-hidden />}
          disabled={items.length >= MAX_SKUS}
          className="font-medium text-brand hover:text-brand"
          onClick={onAdd}
        >
          添加 SKU
        </TextAction>
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
