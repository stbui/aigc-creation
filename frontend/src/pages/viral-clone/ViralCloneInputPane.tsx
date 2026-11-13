import type { RefObject } from 'react';

import type { PublicModelGroup } from './api';
import type { AssetSlot, CloneDegree } from './constants';
import { ToolGenerationSubmitBar, ToolTypeTabs } from './components';
import type { UploadedImage } from './hooks';
import { ViralCloneFormSection } from './ViralCloneFormSection';
import { ViralCloneDegreeCard } from './ViralCloneDegreeCard';
import { ViralCloneRequirementCard } from './ViralCloneRequirementCard';

/**
 * 爆款复刻工作台左栏：业务类型 tab + 配置卡 + 复刻要求 + 复刻程度 + 提交栏。
 *
 * 表单、上传、弹窗与提交的状态全部在 `page.tsx`，这里只负责左栏结构与事件转发。
 * 与 `ViralCloneOutputPane`（功能示例 / 创作结果）一起构成页面的左右分栏：
 * 展示组件不持有业务状态，避免把「提交 / 扣费」逻辑分散到布局层。
 *
 * 骨架与商品主图 / 商品详情同源：`pk-input-pane` → `pk-form-card` →
 * `pk-form-scroll`（内含多张 `pk-config-card`）+ 底部 `ToolGenerationSubmitBar`。
 * 三页共用同一套工具页皮肤，不再各自包一层 Card，否则栏内分组、圆角与留白
 * 会与相邻页面对不上。
 */
export interface ViralCloneInputPaneProps {
  // ── 上传 ──
  images: UploadedImage[];
  /** 商品图位上限，已为参考图预留 1 个模型输入位 */
  maxImages: number;
  reference: UploadedImage | null;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  referenceInputRef: RefObject<HTMLInputElement | null>;
  onProductFiles: (files: FileList | File[]) => void;
  onReferenceFiles: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  onRemoveReference: () => void;
  onOpenLibrary: (target: AssetSlot) => void;
  onOpenMobile: (target: AssetSlot) => void;

  // ── 生成设置 ──
  productName: string;
  onProductNameChange: (value: string) => void;
  brand: string;
  onBrandChange: (value: string) => void;
  platform: string;
  onPlatformChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;

  // ── 复刻要求 / 复刻程度 ──
  requirement: string;
  onRequirementChange: (value: string) => void;
  onExpandRequirement: () => void;
  degree: CloneDegree;
  onDegreeChange: (value: CloneDegree) => void;

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
  /** 能力下线 / 无可用线路时的可读原因 */
  unavailableReason: string | null;
  creditLabel: string | null;
  onSubmit: () => void;
}

export function ViralCloneInputPane({
  images,
  maxImages,
  reference,
  uploading,
  fileInputRef,
  referenceInputRef,
  onProductFiles,
  onReferenceFiles,
  onRemoveImage,
  onRemoveReference,
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
  requirement,
  onRequirementChange,
  onExpandRequirement,
  degree,
  onDegreeChange,
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
  unavailableReason,
  creditLabel,
  onSubmit,
}: ViralCloneInputPaneProps) {
  return (
    <aside className="pk-input-pane" aria-label="爆款复刻设置">
      <div className="pk-form-card">
        <ToolTypeTabs active="viral-clone" />

        <div className="pk-form-scroll">
          <ViralCloneFormSection
            images={images}
            maxImages={maxImages}
            reference={reference}
            uploading={uploading}
            fileInputRef={fileInputRef}
            referenceInputRef={referenceInputRef}
            productName={productName}
            brand={brand}
            platform={platform}
            language={language}
            onProductFiles={onProductFiles}
            onReferenceFiles={onReferenceFiles}
            onRemoveImage={onRemoveImage}
            onRemoveReference={onRemoveReference}
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
            onProductNameChange={onProductNameChange}
            onBrandChange={onBrandChange}
            onPlatformChange={onPlatformChange}
            onLanguageChange={onLanguageChange}
          />

          <ViralCloneRequirementCard
            requirement={requirement}
            onRequirementChange={onRequirementChange}
            onExpand={onExpandRequirement}
          />

          <ViralCloneDegreeCard degree={degree} onDegreeChange={onDegreeChange} />
        </div>

        {/* 高级设置 + 提交 (sticky 底部)；不可用原因走共享提示行样式 */}
        <ToolGenerationSubmitBar
          capability="hot_remake"
          generating={generating}
          disabled={!formValid || Boolean(unavailableReason)}
          creditLabel={creditLabel}
          hint={
            unavailableReason && !generating ? (
              <span className="tool-submit-notice tool-submit-notice-error">{unavailableReason}</span>
            ) : undefined
          }
          settingsOpen={settingsOpen}
          ratio={ratio}
          resolution={resolution}
          onToggleSettings={onToggleSettings}
          onRatioChange={onRatioChange}
          onResolutionChange={onResolutionChange}
          onModelQuoteChange={onModelQuoteChange}
          onModelChange={onModelChange}
          onSubmit={onSubmit}
        />
      </div>
    </aside>
  );
}
