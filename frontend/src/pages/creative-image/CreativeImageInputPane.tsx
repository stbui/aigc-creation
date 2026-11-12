import { MAX_REF_IMAGES, type CreationCapability } from './constants';
import type { ToolAsset } from './components';
import { CreativeImagePromptField } from './CreativeImagePromptField';
import { CreativeImageSubmitBar } from './CreativeImageSubmitBar';
import { CreativeImageUploadSection } from './CreativeImageUploadSection';

interface CreativeImageInputPaneProps {
  capability: CreationCapability;
  capabilityLabel: string;
  images: ToolAsset[];
  uploading: boolean;
  onUploadFiles: (files: FileList | File[]) => void | Promise<void>;
  onRemoveImage: (id: string) => void;
  onMoveImage: (index: number, direction: -1 | 1) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPolish: () => void;
  onImageToPrompt: () => void;
  onExpandPrompt: () => void;
  generating: boolean;
  submitDisabled: boolean;
  creditLabel: string | null;
  unavailableReason: string | null;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;
  onSubmit: () => void;
}

/**
 * 左栏输入区：标题、参考图上传、创作提示词与底部提交区。
 *
 * 状态与上传 / 提交等写操作仍留在 `page.tsx`，本组件只做板块编排。
 */
export function CreativeImageInputPane({
  capability,
  capabilityLabel,
  images,
  uploading,
  onUploadFiles,
  onRemoveImage,
  onMoveImage,
  onOpenLibrary,
  onOpenMobile,
  prompt,
  onPromptChange,
  onPolish,
  onImageToPrompt,
  onExpandPrompt,
  generating,
  submitDisabled,
  creditLabel,
  unavailableReason,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  onModelQuoteChange,
  onSubmit,
}: CreativeImageInputPaneProps) {
  return (
    <aside className="pk-input-pane">
      <div className="pk-form-card">
        {/* 窄屏标题头 (桌面 display:none 实拍确认) */}
        <div className="fc-section-head">
          <span>{capabilityLabel}</span>
          <h1>输入提示词，直接生成图片</h1>
        </div>

        <div className="pk-form-scroll">
          <section className="pk-config-card">
            <CreativeImageUploadSection
              images={images}
              maxImages={MAX_REF_IMAGES}
              uploading={uploading}
              onUploadFiles={onUploadFiles}
              onRemoveImage={onRemoveImage}
              onMoveImage={onMoveImage}
              onOpenLibrary={onOpenLibrary}
              onOpenMobile={onOpenMobile}
            />
            <CreativeImagePromptField
              value={prompt}
              onChange={onPromptChange}
              onPolish={onPolish}
              onImageToPrompt={onImageToPrompt}
              onExpand={onExpandPrompt}
            />
          </section>
        </div>

        <CreativeImageSubmitBar
          generating={generating}
          disabled={submitDisabled}
          creditLabel={creditLabel}
          unavailableReason={unavailableReason}
          settingsOpen={settingsOpen}
          onToggleSettings={onToggleSettings}
          ratio={ratio}
          onRatioChange={onRatioChange}
          resolution={resolution}
          onResolutionChange={onResolutionChange}
          capability={capability}
          onModelQuoteChange={onModelQuoteChange}
          onSubmit={onSubmit}
        />
      </div>
    </aside>
  );
}
