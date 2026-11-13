import type { RefObject } from 'react';

import { DETAIL_CAPABILITY } from './api';
import { MAX_DESC_LEN, MAX_IMAGES } from './constants';
import { ProductFormSection, ToolGenerationSubmitBar, ToolTypeTabs } from './components';
import type { UploadedImage } from './hooks';
import { DetailSectionPicker } from './DetailSectionPicker';

/**
 * 商品详情图工作台左栏：业务类型 tab + 表单区 + 包含模块 + 提交栏。
 *
 * 表单、上传与提交的状态全部在 `page.tsx`，这里只负责左栏结构与事件转发。
 * 商品图 + 基础字段 + 描述由共享 `ProductFormSection` 渲染，提交区由共享
 * `ToolGenerationSubmitBar` 渲染 —— 本页只声明差异（不可提交提示）。
 */
export interface DetailInputPaneProps {
  // ── 上传 ──
  images: UploadedImage[];
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
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

  // ── 包含模块 ──
  sections: string[];
  onToggleSection: (value: string) => void;

  // ── 高级设置 ──
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;

  // ── 提交 ──
  generating: boolean;
  submitDisabled: boolean;
  /** 不可提交原因（能力下线 / 无可用线路），由页面按登录态决定是否展示 */
  submitHint?: string;
  creditLabel?: string | null;
  onSubmit: () => void;
}

export function DetailInputPane({
  images,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
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
  sections,
  onToggleSection,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  onModelQuoteChange,
  generating,
  submitDisabled,
  submitHint,
  creditLabel,
  onSubmit,
}: DetailInputPaneProps) {
  return (
    <aside className="pk-input-pane">
      <div className="pk-form-card">
        <ToolTypeTabs active="product-detail" />

        <div className="pk-form-scroll">
          <ProductFormSection
            images={images}
            max={MAX_IMAGES}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onFiles={onFiles}
            onRemove={onRemove}
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
            maxLength={MAX_DESC_LEN}
            descriptionRows={3}
          />

          <DetailSectionPicker selected={sections} onToggle={onToggleSection} />
        </div>

        {/* 高级设置 + 提交 (sticky 底部) */}
        <ToolGenerationSubmitBar
          capability={DETAIL_CAPABILITY}
          generating={generating}
          disabled={submitDisabled}
          creditLabel={creditLabel}
          hint={
            submitHint ? (
              <span className="tool-submit-notice tool-submit-notice-error">{submitHint}</span>
            ) : undefined
          }
          settingsOpen={settingsOpen}
          onToggleSettings={onToggleSettings}
          ratio={ratio}
          onRatioChange={onRatioChange}
          resolution={resolution}
          onResolutionChange={onResolutionChange}
          onModelQuoteChange={onModelQuoteChange}
          onSubmit={onSubmit}
        />
      </div>
    </aside>
  );
}
