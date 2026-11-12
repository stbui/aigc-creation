import type { RefObject } from 'react';

import { CAPABILITY_ID, MAX_IMAGES, MAX_IMAGE_MB } from './constants';
import { ModelPicker, ToolImageDropzone, ToolSettingsPopover, ToolSubmitBar } from './components';
import type { UploadedImage } from './hooks';
import type { TemplateEntry } from './utils';
import { TemplateSelectedCard } from './TemplateSelectedCard';

interface TemplateInputPaneProps {
  images: UploadedImage[];
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onOpenLibrary: () => void;
  onOpenMobile: () => void;
  selectedTemplate: TemplateEntry | null;
  onClearTemplate: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  onModelQuoteChange: (credits: number | null) => void;
  generating: boolean;
  submitDisabled: boolean;
  guestLabel: string | undefined;
  creditLabel: string | null;
  hint: string | undefined;
  onSubmit: () => void;
}

/** 左栏：人像上传、已选模板回显与固定底栏（高级设置 + 提交）。 */
export function TemplateInputPane({
  images,
  uploading,
  fileInputRef,
  onFiles,
  onRemove,
  onOpenLibrary,
  onOpenMobile,
  selectedTemplate,
  onClearTemplate,
  settingsOpen,
  onToggleSettings,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  onModelQuoteChange,
  generating,
  submitDisabled,
  guestLabel,
  creditLabel,
  hint,
  onSubmit,
}: TemplateInputPaneProps) {
  return (
    <aside className="tpl-input-pane">
      <div className="tpl-form-card">
        <div className="tpl-form-scroll">
          <ToolImageDropzone
            title="上传人像照片"
            noun="人像照片"
            required
            images={images}
            max={MAX_IMAGES}
            maxMb={MAX_IMAGE_MB}
            uploading={uploading}
            fileInputRef={fileInputRef}
            onFiles={onFiles}
            onRemove={onRemove}
            onOpenLibrary={onOpenLibrary}
            onOpenMobile={onOpenMobile}
            emptyHint={`至少上传 1 张清晰人像；最多 ${MAX_IMAGES} 张，单张不超过 ${MAX_IMAGE_MB}MB`}
          />

          <TemplateSelectedCard template={selectedTemplate} onClear={onClearTemplate} />
        </div>

        <div className="tpl-form-footer">
          <div className="tpl-footer-row">
            <ToolSettingsPopover
              open={settingsOpen}
              onToggle={onToggleSettings}
              ratio={ratio}
              onRatioChange={onRatioChange}
              resolution={resolution}
              onResolutionChange={onResolutionChange}
              capabilityId={CAPABILITY_ID}
              modelPicker={
                <ModelPicker
                  capability={CAPABILITY_ID}
                  options={{ ratio, size: resolution }}
                  onQuoteChange={onModelQuoteChange}
                />
              }
            />
          </div>
          <ToolSubmitBar
            submitting={generating}
            disabled={submitDisabled}
            label="生成婚纱写真"
            guestLabel={guestLabel}
            creditLabel={creditLabel ?? undefined}
            hint={hint}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    </aside>
  );
}
