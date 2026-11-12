import type { RefObject } from 'react';

import { DETAIL_CAPABILITY } from './api';
import { ModelPicker, ToolSettingsPopover, ToolSubmitBar } from './components';
import type { UploadedImage } from './hooks';
import { DetailFormSection } from './DetailFormSection';
import { DetailSectionPicker } from './DetailSectionPicker';
import { DetailToolTabs } from './DetailToolTabs';

/**
 * 商品详情图工作台左栏：业务类型 tab + 表单区 + 包含模块 + 提交栏。
 *
 * 表单、上传与提交的状态全部在 `page.tsx`，这里只负责左栏结构与事件转发。
 * 展示组件不持有业务状态，避免把「提交 / 扣费」逻辑分散到布局层。
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
        <DetailToolTabs />

        <div className="pk-form-scroll">
          <DetailFormSection
            images={images}
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
          />

          <DetailSectionPicker selected={sections} onToggle={onToggleSection} />
        </div>

        {/* 高级设置 + 提交 (sticky 底部) */}
        <ToolSubmitBar
          submitting={generating}
          disabled={submitDisabled}
          label="立即生成"
          creditLabel={creditLabel ?? undefined}
          hint={
            submitHint ? (
              <span className="tool-submit-notice tool-submit-notice-error">{submitHint}</span>
            ) : undefined
          }
          settings={
            <ToolSettingsPopover
              open={settingsOpen}
              onToggle={onToggleSettings}
              resolution={resolution}
              onResolutionChange={onResolutionChange}
              ratio={ratio}
              onRatioChange={onRatioChange}
              capabilityId={DETAIL_CAPABILITY}
              modelPicker={
                <ModelPicker
                  capability={DETAIL_CAPABILITY}
                  options={{ ratio, resolution }}
                  onQuoteChange={onModelQuoteChange}
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
