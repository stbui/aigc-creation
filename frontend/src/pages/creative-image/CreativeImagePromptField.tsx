import { Maximize2, Sparkles } from 'lucide-react';

import { CREATION_PROMPT_PLACEHOLDER, MAX_PROMPT_LEN } from './constants';
import { SectionCard } from './components';

interface CreativeImagePromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  onPolish: () => void;
  onImageToPrompt: () => void;
  onExpand: () => void;
}

/** 提示词工具入口（AI润色 / 图片转提示词）共用的文字按钮皮肤 */
const TOOL_BTN =
  'flex h-4 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs text-brand';

/** 创作提示词输入区：工具入口与主文本域保持同页视觉和交互。 */
export function CreativeImagePromptField({
  value,
  onChange,
  onPolish,
  onImageToPrompt,
  onExpand,
}: CreativeImagePromptFieldProps) {
  return (
    <SectionCard
      title={
        <span className="before:mr-0.5 before:text-[color:var(--danger-ref)] before:content-['*']">
          创作提示词
        </span>
      }
      extra={
        <>
          <button
            type="button"
            className={TOOL_BTN}
            title="AI 优化当前创作提示词"
            onClick={onPolish}
          >
            <Sparkles size={13} />
            <span>AI润色</span>
          </button>
          <button
            type="button"
            className={TOOL_BTN}
            title="上传图片，AI 反推创作提示词"
            onClick={onImageToPrompt}
          >
            <Sparkles size={13} />
            <span>图片转提示词</span>
          </button>
        </>
      }
    >
      <div className="pk-desc-editor">
        {/* 共享皮肤给的是 80px + resize:none；本页拉高到 140px 并允许纵向拉伸 */}
        <textarea
          className="h-[140px]! resize-y!"
          rows={8}
          maxLength={MAX_PROMPT_LEN}
          value={value}
          placeholder={CREATION_PROMPT_PLACEHOLDER}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="pk-desc-expand"
          aria-label="放大编辑创作提示词"
          title="编辑"
          onClick={onExpand}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </SectionCard>
  );
}
