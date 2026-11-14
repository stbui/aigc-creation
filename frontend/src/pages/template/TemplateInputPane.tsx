import type { RefObject } from 'react';
import { Lightbulb } from 'lucide-react';

import { CAPABILITY_ID, MAX_IMAGES, MAX_IMAGE_MB } from './constants';
import { ModelPicker, ToolGenerationSubmitBar, ToolImageDropzone } from './components';
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

/** 左栏：人像上传、已选模板回显与提交区（高级设置 + 提交）。 */
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
    <aside className="pk-input-pane">
      <div className="pk-form-scroll">
        <section className="pk-config-card">
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

          <div className="tpl-tips">
            <strong className="pk-section-title u-font-14">
              <Lightbulb size={14} />
              拍摄建议
            </strong>
            <ul className="tpl-tips-list">
              <li>正脸清晰、五官无遮挡，生成的相似度更高</li>
              <li>光线均匀的日常照、证件照都可以直接使用</li>
              <li>选好模板后，可点封面左上角的眼睛查看大图</li>
            </ul>
          </div>
        </section>
      </div>

      {/* 高级设置 + 提交（与商品主图 / 商品详情同一块共享组件） */}
      <ToolGenerationSubmitBar
        capability={CAPABILITY_ID}
        generating={generating}
        disabled={submitDisabled}
        label="生成写真"
        guestLabel={guestLabel}
        creditLabel={creditLabel}
        hint={hint}
        settingsOpen={settingsOpen}
        onToggleSettings={onToggleSettings}
        ratio={ratio}
        onRatioChange={onRatioChange}
        resolution={resolution}
        onResolutionChange={onResolutionChange}
        onModelQuoteChange={onModelQuoteChange}
        settingsProps={{
          // 写真模板页不展示「单次约 X 积分」报价行；报价回调仍驱动按钮价签
          modelPicker: (
            <ModelPicker
              capability={CAPABILITY_ID}
              options={{ ratio, resolution }}
              onQuoteChange={onModelQuoteChange}
              showQuote={false}
            />
          ),
        }}
        onSubmit={onSubmit}
      />
    </aside>
  );
}
