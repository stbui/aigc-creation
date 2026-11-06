import { Maximize2, Sparkles } from 'lucide-react';

import { MAX_PROMPT_LEN } from './constants';

interface CreationPromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  onPolish: () => void;
  onImageToPrompt: () => void;
  onExpand: () => void;
}

/** 创作提示词输入区：工具入口与主文本域保持同页视觉和交互。 */
export function CreationPromptField({
  value,
  onChange,
  onPolish,
  onImageToPrompt,
  onExpand,
}: CreationPromptFieldProps) {
  return (
    <div className="pk-section fc-prompt-field">
      <div className="fc-prompt-label-row">
        <span>创作提示词</span>
        <div className="fc-prompt-tools">
          <button type="button" className="fc-prompt-tool-btn" title="AI 优化当前创作提示词" onClick={onPolish}>
            <Sparkles size={13} />
            <span>AI润色</span>
          </button>
          <button
            type="button"
            className="fc-prompt-tool-btn"
            title="上传图片，AI 反推创作提示词"
            onClick={onImageToPrompt}
          >
            <Sparkles size={13} />
            <span>图片转提示词</span>
          </button>
        </div>
      </div>
      <div className="pk-desc-editor">
        <textarea
          className="fc-prompt-textarea"
          rows={8}
          maxLength={MAX_PROMPT_LEN}
          value={value}
          placeholder="例如：把这款产品放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感"
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
    </div>
  );
}
