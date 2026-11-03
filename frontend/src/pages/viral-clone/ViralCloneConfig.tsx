import type { RefObject } from 'react';

import {
  MAX_IMAGE_MB,
  MAX_NAME_LEN,
  type PkAsset,
} from './constants';
import {
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  Separator,
  ToolImageDropzone,
} from './components';
import { languageOptions, platformOptions } from './utils';

/**
 * 上传商品图 / 上传参考图（爆款图）/ 生成设置。
 *
 * 三者在参考站同属一张配置卡；参考图是单张位，标题行不显示计数器。
 */
export function ViralCloneConfig({
  images,
  maxImages,
  totalImageMax,
  imageLimitError,
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
  images: PkAsset[];
  /** 商品图位上限，已为参考图预留 1 个模型输入位 */
  maxImages: number;
  /** 模型合同允许的商品图 + 参考图总数 */
  totalImageMax: number | null;
  /** 当前图片总数超过模型上限时的可读原因 */
  imageLimitError: string | null;
  reference: PkAsset | null;
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
  onOpenLibrary: (target: 'product' | 'reference') => void;
  onOpenMobile: (target: 'product' | 'reference') => void;
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
      {totalImageMax !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          当前模型最多接收 {totalImageMax} 张图片（含 1 张参考图），商品图可上传 {maxImages} 张。
        </p>
      )}
      {imageLimitError && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {imageLimitError}
        </p>
      )}

      {/* 参考图: 独立 section, 单张上传, 标题行无计数器 */}
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

      <Separator />

      <section className="vc-generation-settings" aria-labelledby="vc-generation-settings-title">
        <h3 id="vc-generation-settings-title" className="text-sm font-semibold text-foreground">
          生成设置
        </h3>
        <FieldGroup className="vc-generation-settings-grid grid grid-cols-2 gap-3">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="vc-product-name" className="text-xs text-muted-foreground">
              商品名称（选填）
            </FieldLabel>
            <Input
              id="vc-product-name"
              value={productName}
              maxLength={MAX_NAME_LEN}
              placeholder="请输入商品名称"
              onChange={(e) => onProductNameChange(e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="vc-brand" className="text-xs text-muted-foreground">
              品牌（选填）
            </FieldLabel>
            <Input
              id="vc-brand"
              value={brand}
              maxLength={MAX_NAME_LEN}
              placeholder="请输入品牌"
              onChange={(e) => onBrandChange(e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">平台</FieldLabel>
            <Select
              value={platform}
              onChange={(value) => onPlatformChange(String(value))}
              options={platformOptions()}
              aria-label="平台"
              className="w-full"
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">语言</FieldLabel>
            <Select
              value={language}
              onChange={(value) => onLanguageChange(String(value))}
              options={languageOptions()}
              aria-label="语言"
              className="w-full"
            />
          </Field>
        </FieldGroup>
      </section>
    </div>
  );
}
