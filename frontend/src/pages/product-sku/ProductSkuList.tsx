import { Plus, Upload, X } from 'lucide-react';

import {
  MAX_SKUS,
  MAX_SKU_NAME,
  SUPPORTED_IMAGE_ACCEPT,
  type SkuItem,
} from './constants';
import type { SkuRegion } from './components';
import { assetThumbUrl } from './api';

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
        <button type="button" disabled={items.length >= MAX_SKUS} onClick={onAdd}>
          <Plus size={12} /> 添加 SKU
        </button>
      </div>
      {items.map((item, itemIndex) => {
        const name = item.name.trim();
        const duplicate = Boolean(name) && (nameCounts.get(name.toLowerCase()) ?? 0) > 1;
        return (
          <article key={item.key} className="product-sku-item-card">
            <div className="product-sku-item-heading">
              <div className="product-sku-item-title-edit">
                <input
                  value={item.name}
                  maxLength={MAX_SKU_NAME}
                  aria-label={`SKU ${itemIndex + 1} 名称`}
                  className={duplicate || !name ? 'is-invalid' : undefined}
                  onChange={(event) => onNameChange(item.key, event.target.value)}
                />
                <span>
                  {item.name.length}/{MAX_SKU_NAME}
                </span>
              </div>
              <button
                type="button"
                aria-label={`移除 SKU ${itemIndex + 1}`}
                title="移除 SKU"
                disabled={items.length <= 1}
                onClick={() => onRemove(item.key)}
              >
                <X size={15} />
              </button>
            </div>
            {duplicate && (
              <p className="product-sku-item-error">SKU 名称不可重复（忽略大小写）</p>
            )}

            {regions.map((region, regionIndex) => {
              const variant = item.variants[region.id] ?? { regionId: region.id, instruction: '' };
              const incomplete = !variant.instruction.trim() && !variant.reference;
              const busy = referenceBusy === `${item.key}:${region.id}`;
              return (
                <div
                  key={region.id}
                  className={`product-sku-variant-row${incomplete ? ' is-incomplete' : ''}`}
                >
                  <div className="product-sku-variant-title">
                    <span className="product-sku-variant-icon">{regionIndex + 1}</span>
                    <strong>区域 {regionIndex + 1}</strong>
                    <label className="product-sku-reference-upload">
                      <Upload size={12} />
                      {busy ? '上传中…' : '上传参考图'}
                      <input
                        type="file"
                        accept={SUPPORTED_IMAGE_ACCEPT}
                        hidden
                        disabled={busy}
                        onChange={(event) =>
                          onUploadReference(
                            event.target.files?.[0],
                            item.key,
                            region.id,
                            event.currentTarget,
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="workspace-material-library-trigger"
                      onClick={() => onOpenReferenceLibrary(item.key, region.id)}
                    >
                      素材库
                    </button>
                    <button
                      type="button"
                      className="mobile-upload-trigger"
                      onClick={() => onOpenReferenceMobile(item.key, region.id)}
                    >
                      手机上传
                    </button>
                  </div>
                  <div className="product-sku-variant-body">
                    <input
                      value={variant.instruction}
                      placeholder="描述该区域要替换成的商品、颜色、材质等"
                      aria-label={`SKU ${itemIndex + 1} 区域 ${regionIndex + 1} 说明`}
                      onChange={(event) =>
                        onInstructionChange(item.key, region.id, event.target.value)
                      }
                    />
                  </div>
                  {variant.reference && (
                    <div className="product-sku-reference-thumb">
                      <button
                        type="button"
                        aria-label="移除参考图"
                        onClick={() => onRemoveReference(item.key, region.id)}
                      >
                        <X size={18} />
                      </button>
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
          </article>
        );
      })}
    </section>
  );
}
