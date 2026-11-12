import type { SkuRegion } from './components';
import type { SkuVariantContent } from './constants';
import { Button, Input } from './components';
import { ProductSkuReferenceThumb } from './ProductSkuReferenceThumb';
import { ProductSkuReferenceUploadButton } from './ProductSkuReferenceUploadButton';

interface ProductSkuVariantRowProps {
  itemKey: number;
  itemIndex: number;
  region: SkuRegion;
  regionIndex: number;
  variant?: SkuVariantContent;
  /** 该区域参考图正在上传 */
  busy: boolean;
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
 * SKU 卡片里的一个变体区域：说明输入 + 参考图三入口。
 *
 * 区域序号只在展示层使用；提交参数仍按 `region.id` 对齐。
 */
export function ProductSkuVariantRow({
  itemKey,
  itemIndex,
  region,
  regionIndex,
  variant,
  busy,
  onInstructionChange,
  onUploadReference,
  onOpenReferenceLibrary,
  onOpenReferenceMobile,
  onRemoveReference,
  onPreview,
}: ProductSkuVariantRowProps) {
  const regionLabel = `SKU ${itemIndex + 1} 区域 ${regionIndex + 1}`;

  return (
    <div className="product-sku-variant-row">
      <div className="product-sku-variant-title">
        <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-brand text-xs text-primary-foreground">
          {regionIndex + 1}
        </span>
        <strong>区域 {regionIndex + 1}</strong>
        <ProductSkuReferenceUploadButton
          busy={busy}
          onPick={(file, input) => onUploadReference(file, itemKey, region.id, input)}
        />
        <Button
          htmlType="button"
          variant="link"
          size="xs"
          className="h-auto border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:text-brand"
          onClick={() => onOpenReferenceLibrary(itemKey, region.id)}
        >
          素材库
        </Button>
        <Button
          htmlType="button"
          variant="link"
          size="xs"
          className="h-auto border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:text-brand"
          onClick={() => onOpenReferenceMobile(itemKey, region.id)}
        >
          手机上传
        </Button>
      </div>
      <div className="product-sku-variant-body">
        <Input
          value={variant?.instruction ?? ''}
          placeholder="文字说明（可选），如：改为绿色"
          aria-label={`${regionLabel} 说明`}
          className="h-5 text-sm focus-visible:bg-brand-bg"
          onChange={(event) => onInstructionChange(itemKey, region.id, event.target.value)}
        />
      </div>
      {variant?.reference && (
        <ProductSkuReferenceThumb
          reference={variant.reference}
          label={`${regionLabel} 参考图`}
          onRemove={() => onRemoveReference(itemKey, region.id)}
          onPreview={onPreview}
        />
      )}
    </div>
  );
}
