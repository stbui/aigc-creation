import type { RefObject } from 'react';

import { MAX_DESC_LEN, PRODUCT_KIT_CAPABILITY } from './constants';
import {
  ProductFormSection,
  ToolGenerationSubmitBar,
  ToolTypeTabs,
  type PublicModelGroup,
} from './components';
import type { UploadedImage } from './hooks';
import { ProductKitVariantConfig } from './ProductKitVariantConfig';

/**
 * 商品主图工作台左栏：业务类型 tab + 生成设置 + 自定义配置 + 提交栏。
 *
 * 表单、上传与提交的状态全部在 `page.tsx`，这里只负责左栏结构与事件转发。
 * 商品图 + 基础字段 + 描述由共享 `ProductFormSection` 渲染，提交区由共享
 * `ToolGenerationSubmitBar` 渲染 —— 本页只声明差异（上传上限、描述高度、变体配置）。
 */
export interface ProductKitInputPaneProps {
  // ── 上传 ──
  images: UploadedImage[];
  /** 当前模型能力合同允许的图片数（已与页面上限取较小值） */
  maxImages: number;
  /** 已选素材超过模型上限时的可读原因 */
  imageLimitError?: string | null;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;

  // ── 生成设置 ──
  productName: string;
  onProductNameChange: (value: string) => void;
  brand: string;
  onBrandChange: (value: string) => void;
  platform: string;
  onPlatformChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  analyzing: boolean;
  onAnalyze: () => void;
  onExpandDescription: () => void;

  // ── 自定义配置 ──
  counts: Record<string, number>;
  onCountChange: (key: string, value: number) => void;

  // ── 高级设置 ──
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;
  onModelChange: (model: PublicModelGroup | null) => void;

  // ── 提交 ──
  generating: boolean;
  formValid: boolean;
  creditLabel?: string | null;
  onSubmit: () => void;
}

export function ProductKitInputPane({
  images,
  maxImages,
  imageLimitError,
  uploading,
  fileInputRef,
  onFiles,
  onRemoveImage,
  onOpenLibrary,
  onOpenMobile,
  productName,
  onProductNameChange,
  brand,
  onBrandChange,
  platform,
  onPlatformChange,
  language,
  onLanguageChange,
  description,
  onDescriptionChange,
  analyzing,
  onAnalyze,
  onExpandDescription,
  counts,
  onCountChange,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  onModelQuoteChange,
  onModelChange,
  generating,
  formValid,
  creditLabel,
  onSubmit,
}: ProductKitInputPaneProps) {
  return (
    <aside className="pk-input-pane">
      <div className="pk-form-card">
        <ToolTypeTabs active="product-kit" />

        <div className="pk-form-scroll">
          <ProductFormSection
            images={images}
            max={maxImages}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onFiles={onFiles}
            onRemove={onRemoveImage}
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
            limitError={imageLimitError}
            productName={productName}
            onProductNameChange={onProductNameChange}
            brand={brand}
            onBrandChange={onBrandChange}
            platform={platform}
            onPlatformChange={onPlatformChange}
            language={language}
            onLanguageChange={onLanguageChange}
            description={description}
            onDescriptionChange={onDescriptionChange}
            analyzing={analyzing}
            onAnalyze={onAnalyze}
            onExpandDescription={onExpandDescription}
            maxLength={MAX_DESC_LEN}
            descriptionRows={5}
          />

          {/* 自定义配置 */}
          <ProductKitVariantConfig counts={counts} onCountChange={onCountChange} />
        </div>

        {/* 高级设置 + 提交 (sticky 底部) */}
        <ToolGenerationSubmitBar
          capability={PRODUCT_KIT_CAPABILITY}
          generating={generating}
          disabled={!formValid}
          creditLabel={creditLabel}
          settingsOpen={settingsOpen}
          onToggleSettings={onToggleSettings}
          ratio={ratio}
          onRatioChange={onRatioChange}
          resolution={resolution}
          onResolutionChange={onResolutionChange}
          onModelQuoteChange={onModelQuoteChange}
          onModelChange={onModelChange}
          onSubmit={onSubmit}
        />
      </div>
    </aside>
  );
}
