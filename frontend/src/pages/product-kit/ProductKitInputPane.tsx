import type { RefObject } from 'react';

import { PRODUCT_KIT_CAPABILITY } from './constants';
import {
  ModelPicker,
  ToolSettingsPopover,
  ToolSubmitBar,
  type PublicLogicalModel,
} from './components';
import type { UploadedImage } from './hooks';
import { ProductKitFormSection } from './ProductKitFormSection';
import { ProductKitToolTabs } from './ProductKitToolTabs';
import { ProductKitVariantConfig } from './ProductKitVariantConfig';

/**
 * 商品主图工作台左栏：业务类型 tab + 生成设置 + 自定义配置 + 提交栏。
 *
 * 表单、上传与提交的状态全部在 `page.tsx`，这里只负责左栏结构与事件转发。
 * 与 `ProductKitFormSection` 的定位一致：展示组件不持有业务状态，避免把
 * 「提交 / 扣费」逻辑分散到布局层。
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
  onModelChange: (model: PublicLogicalModel | null) => void;

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
        <ProductKitToolTabs />

        <div className="pk-form-scroll">
          {/* 上传商品图 + 生成设置 + 商品描述 (参考站同一张卡片) */}
          <ProductKitFormSection
            images={images}
            maxImages={maxImages}
            imageLimitError={imageLimitError}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onFiles={onFiles}
            onRemove={onRemoveImage}
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
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
          />

          {/* 自定义配置 */}
          <ProductKitVariantConfig counts={counts} onCountChange={onCountChange} />
        </div>

        {/* 高级设置 + 提交 (sticky 底部) */}
        <ToolSubmitBar
          submitting={generating}
          disabled={!formValid}
          label="立即生成"
          creditLabel={creditLabel ?? undefined}
          settings={
            <ToolSettingsPopover
              open={settingsOpen}
              onToggle={onToggleSettings}
              ratio={ratio}
              onRatioChange={onRatioChange}
              resolution={resolution}
              onResolutionChange={onResolutionChange}
              capabilityId={PRODUCT_KIT_CAPABILITY}
              modelPicker={
                <ModelPicker
                  capability={PRODUCT_KIT_CAPABILITY}
                  options={{ ratio, resolution }}
                  onQuoteChange={onModelQuoteChange}
                  onModelChange={onModelChange}
                />
              }
            />
          }
          onSubmit={onSubmit}
        />
      </div>
    </aside>
  );
}
