import { X } from 'lucide-react';

import { MAX_SKU_NAME, type SkuItem } from './constants';
import {
  Button,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  InputGroup,
  InputGroupInput,
  InputGroupText,
  Surface,
  type SkuRegion,
} from './components';
import { ProductSkuVariantRow } from './ProductSkuVariantRow';

interface ProductSkuListItemProps {
  item: SkuItem;
  itemIndex: number;
  regions: SkuRegion[];
  /** 名称与其它 SKU 重复（忽略大小写） */
  duplicate: boolean;
  /** 只剩一行时禁止移除 */
  canRemove: boolean;
  referenceBusy: string | null;
  onNameChange: (key: number, name: string) => void;
  onRemove: (key: number) => void;
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
 * SKU 清单里的一行：名称编辑、重复提示与按区域展开的变体。
 *
 * 完整校验（必填、长度、区域缺失）由页面汇总成一句 hint；
 * 这里只做「名称重复」的即时视觉提示，不产生第二套校验口径。
 */
export function ProductSkuListItem({
  item,
  itemIndex,
  regions,
  duplicate,
  canRemove,
  referenceBusy,
  onNameChange,
  onRemove,
  onInstructionChange,
  onUploadReference,
  onOpenReferenceLibrary,
  onOpenReferenceMobile,
  onRemoveReference,
  onPreview,
}: ProductSkuListItemProps) {
  return (
    <Surface className="gap-0 border-0 bg-card p-4 shadow-none">
      <Field data-invalid={duplicate || undefined} className="gap-0">
        <FieldLabel htmlFor={`sku-name-${item.key}`} className="sr-only">
          SKU {itemIndex + 1} 名称
        </FieldLabel>
        <FieldContent className="gap-0">
          <div className="mb-3 flex min-h-5 items-center justify-between gap-2">
            <InputGroup className="h-8 min-h-8 min-w-0 flex-1 border-0 shadow-none focus-within:bg-brand-bg focus-within:ring-2 focus-within:ring-primary">
              <InputGroupInput
                id={`sku-name-${item.key}`}
                value={item.name}
                maxLength={MAX_SKU_NAME}
                aria-invalid={duplicate || undefined}
                className="text-sm"
                onChange={(event) => onNameChange(item.key, event.target.value)}
              />
              <InputGroupText className="shrink-0 pr-2 text-xs">
                {item.name.length}/{MAX_SKU_NAME}
              </InputGroupText>
            </InputGroup>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`移除 SKU ${itemIndex + 1}`}
              title="移除 SKU"
              disabled={!canRemove}
              className="text-muted-foreground"
              onClick={() => onRemove(item.key)}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          {duplicate && (
            <FieldError className="-mt-1.5 mb-2.5 text-xs">
              SKU 名称不可重复（忽略大小写）
            </FieldError>
          )}
        </FieldContent>
      </Field>

      {regions.map((region, regionIndex) => (
        <ProductSkuVariantRow
          key={region.id}
          itemKey={item.key}
          itemIndex={itemIndex}
          region={region}
          regionIndex={regionIndex}
          variant={item.variants[region.id]}
          busy={referenceBusy === `${item.key}:${region.id}`}
          onInstructionChange={onInstructionChange}
          onUploadReference={onUploadReference}
          onOpenReferenceLibrary={onOpenReferenceLibrary}
          onOpenReferenceMobile={onOpenReferenceMobile}
          onRemoveReference={onRemoveReference}
          onPreview={onPreview}
        />
      ))}
    </Surface>
  );
}
