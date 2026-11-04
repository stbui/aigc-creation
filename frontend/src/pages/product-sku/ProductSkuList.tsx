import { useRef } from 'react';
import { Plus, Upload, X } from 'lucide-react';

import {
  MAX_SKUS,
  MAX_SKU_NAME,
  SUPPORTED_IMAGE_ACCEPT,
  type SkuItem,
} from './constants';
import {
  Button,
  Input,
  InputGroup,
  InputGroupInput,
  InputGroupText,
  Surface,
  type SkuRegion,
} from './components';
import { assetThumbUrl } from './api';

/** 变体区域内的「上传参考图」入口：按钮触发隐藏文件选择框。 */
function ReferenceUploadButton({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick: (file: File | undefined, input: HTMLInputElement) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        htmlType="button"
        variant="link"
        size="xs"
        disabled={busy}
        className="h-auto gap-1 border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:text-brand"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-3" />
        {busy ? '上传中…' : '上传参考图'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_IMAGE_ACCEPT}
        hidden
        disabled={busy}
        onChange={(event) => onPick(event.target.files?.[0], event.currentTarget)}
      />
    </>
  );
}

/**
 * SKU 清单：每行一个 SKU，每行按已框选区域展开变体。
 *
 * 名称重复、说明/参考图缺失只用视觉状态提示；提交前的完整校验在页面层统一
 * 汇总成一句 hint，避免这里与 `validationMessage` 出现两套口径。
 */
export function ProductSkuList({
  items,
  regions,
  nameCounts,
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
}: {
  items: SkuItem[];
  regions: SkuRegion[];
  nameCounts: Map<string, number>;
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
}) {
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

      {items.map((item, itemIndex) => {
        const name = item.name.trim();
        const duplicate = Boolean(name) && (nameCounts.get(name.toLowerCase()) ?? 0) > 1;
        return (
          <Surface
            key={item.key}
            className="product-sku-item-card gap-0 border-0 shadow-none"
          >
            <div className="product-sku-item-heading">
              <InputGroup className="h-8 min-h-8 min-w-0 flex-1 border-0 shadow-none focus-within:bg-brand-bg focus-within:ring-2 focus-within:ring-primary">
                <InputGroupInput
                  value={item.name}
                  maxLength={MAX_SKU_NAME}
                  aria-label={`SKU ${itemIndex + 1} 名称`}
                  className="text-sm"
                  onChange={(event) => onNameChange(item.key, event.target.value)}
                />
                <InputGroupText className="shrink-0 pr-2 text-xs">
                  {item.name.length}/{MAX_SKU_NAME}
                </InputGroupText>
              </InputGroup>
              <Button
                htmlType="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`移除 SKU ${itemIndex + 1}`}
                title="移除 SKU"
                disabled={items.length <= 1}
                className="text-muted-foreground"
                onClick={() => onRemove(item.key)}
              >
                <X className="size-4" />
              </Button>
            </div>
            {duplicate && (
              <p className="product-sku-item-error">SKU 名称不可重复（忽略大小写）</p>
            )}

            {regions.map((region, regionIndex) => {
              const variant = item.variants[region.id] ?? { regionId: region.id, instruction: '' };
              const busy = referenceBusy === `${item.key}:${region.id}`;
              return (
                <div key={region.id} className="product-sku-variant-row">
                  <div className="product-sku-variant-title">
                    <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-brand text-xs text-primary-foreground">
                      {regionIndex + 1}
                    </span>
                    <strong>区域 {regionIndex + 1}</strong>
                    <ReferenceUploadButton
                      busy={busy}
                      onPick={(file, input) => onUploadReference(file, item.key, region.id, input)}
                    />
                    <Button
                      htmlType="button"
                      variant="link"
                      size="xs"
                      className="h-auto border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:text-brand"
                      onClick={() => onOpenReferenceLibrary(item.key, region.id)}
                    >
                      素材库
                    </Button>
                    <Button
                      htmlType="button"
                      variant="link"
                      size="xs"
                      className="h-auto border-0 bg-transparent p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:text-brand"
                      onClick={() => onOpenReferenceMobile(item.key, region.id)}
                    >
                      手机上传
                    </Button>
                  </div>
                  <div className="product-sku-variant-body">
                    <Input
                      value={variant.instruction}
                      placeholder="文字说明（可选），如：改为绿色"
                      aria-label={`SKU ${itemIndex + 1} 区域 ${regionIndex + 1} 说明`}
                      className="h-5 text-sm focus-visible:bg-brand-bg"
                      onChange={(event) =>
                        onInstructionChange(item.key, region.id, event.target.value)
                      }
                    />
                  </div>
                  {variant.reference && (
                    <div className="product-sku-reference-thumb">
                      <Button
                        htmlType="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="移除参考图"
                        onClick={() => onRemoveReference(item.key, region.id)}
                      >
                        <X className="size-4" />
                      </Button>
                      <img
                        src={assetThumbUrl(variant.reference.url, 240) ?? variant.reference.url}
                        alt={`SKU ${itemIndex + 1} 区域 ${regionIndex + 1} 参考图`}
                        onClick={() => onPreview(variant.reference!.url)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </Surface>
        );
      })}
    </section>
  );
}
