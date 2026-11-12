import type { RefObject } from 'react';

import { MAX_IMAGE_MB, type AssetSlot } from './constants';
import { ProductFieldsGrid, ToolImageDropzone } from './components';
import type { UploadedImage } from './hooks';

/**
 * 爆款复刻左栏表单区：上传商品图 / 上传参考图（爆款图）/ 生成设置。
 *
 * 与商品详情、商品主图的 `*FormSection` 同角色；三者在参考站同属一张配置卡。
 * 参考图是单张位，标题行不显示计数器。商品基础字段走共享 `ProductFieldsGrid`，
 * 名称 / 品牌在本页为选填。
 */
export function ViralCloneFormSection({
  images,
  maxImages,
  reference,
  uploading,
  fileInputRef,
  referenceInputRef,
  productName,
  brand,
  platform,
  language,
  onProductFiles,
  onReferenceFiles,
  onRemoveImage,
  onRemoveReference,
  onOpenLibrary,
  onOpenMobile,
  onProductNameChange,
  onBrandChange,
  onPlatformChange,
  onLanguageChange,
}: {
  images: UploadedImage[];
  /** 商品图位上限，已为参考图预留 1 个模型输入位 */
  maxImages: number;
  reference: UploadedImage | null;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  referenceInputRef: RefObject<HTMLInputElement | null>;
  productName: string;
  brand: string;
  platform: string;
  language: string;
  onProductFiles: (files: FileList | File[]) => void;
  onReferenceFiles: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  onRemoveReference: () => void;
  onOpenLibrary: (target: AssetSlot) => void;
  onOpenMobile: (target: AssetSlot) => void;
  onProductNameChange: (value: string) => void;
  onBrandChange: (value: string) => void;
  onPlatformChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
}) {
  return (
    <div className="vc-config-section">
      <ToolImageDropzone
        title="上传商品图"
        images={images}
        max={maxImages}
        maxMb={MAX_IMAGE_MB}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onFiles={onProductFiles}
        onRemove={onRemoveImage}
        onOpenLibrary={() => onOpenLibrary('product')}
        onOpenMobile={() => onOpenMobile('product')}
        noun="商品图片"
      />
      <ToolImageDropzone
        title="上传参考图（爆款图）"
        images={reference ? [reference] : []}
        max={1}
        maxMb={MAX_IMAGE_MB}
        uploading={uploading}
        fileInputRef={referenceInputRef}
        onFiles={onReferenceFiles}
        onRemove={onRemoveReference}
        onOpenLibrary={() => onOpenLibrary('reference')}
        onOpenMobile={() => onOpenMobile('reference')}
        noun="参考图片"
        sectionClassName="vc-reference-section"
        dropzoneClassName="pk-dropzone-reference"
        single
        showCount={false}
        emptyHint={`上传或粘贴要复刻风格的参考图，最多 1 张，单张不超过 ${MAX_IMAGE_MB}MB`}
      />

      <section className="vc-generation-settings" aria-labelledby="vc-generation-settings-title">
        <h3 id="vc-generation-settings-title" className="text-sm font-semibold text-foreground">
          生成设置
        </h3>
        <ProductFieldsGrid
          productName={productName}
          onProductNameChange={onProductNameChange}
          brand={brand}
          onBrandChange={onBrandChange}
          platform={platform}
          onPlatformChange={onPlatformChange}
          language={language}
          onLanguageChange={onLanguageChange}
          required={false}
          showTitle={false}
        />
      </section>
    </div>
  );
}
