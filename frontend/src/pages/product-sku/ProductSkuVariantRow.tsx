import type { SkuRegion } from './components';
import type { SkuVariantContent } from './constants';
import { Badge, Field, FieldLabel, Input, TextAction } from './components';
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
    <div
      className={`relative rounded-md border border-transparent bg-muted p-4${
        regionIndex > 0 ? ' mt-4' : ''
      } ${variant?.reference ? 'pr-16 max-[1366px]:pr-4' : ''}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge className="mr-auto gap-1.5 py-0 text-xs font-normal">
          <span className="grid size-4 place-items-center rounded-full bg-primary-foreground text-brand">
            {regionIndex + 1}
          </span>
          区域 {regionIndex + 1}
        </Badge>
        <ProductSkuReferenceUploadButton
          busy={busy}
          onPick={(file, input) => onUploadReference(file, itemKey, region.id, input)}
        />
        <TextAction onClick={() => onOpenReferenceLibrary(itemKey, region.id)}>素材库</TextAction>
        <TextAction onClick={() => onOpenReferenceMobile(itemKey, region.id)}>手机上传</TextAction>
      </div>
      <Field className="gap-0">
        <FieldLabel htmlFor={`sku-instruction-${itemKey}-${region.id}`} className="sr-only">
          {regionLabel} 说明
        </FieldLabel>
        <Input
          id={`sku-instruction-${itemKey}-${region.id}`}
          value={variant?.instruction ?? ''}
          placeholder="文字说明（可选），如：改为绿色"
          className="h-6 w-full min-w-0 border-0 bg-transparent px-0 text-sm text-foreground shadow-none focus-visible:bg-brand-bg focus-visible:ring-0"
          onChange={(event) => onInstructionChange(itemKey, region.id, event.target.value)}
        />
      </Field>
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
