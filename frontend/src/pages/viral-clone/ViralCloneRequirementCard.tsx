import { Maximize2 } from 'lucide-react';

import { MAX_REQUIREMENT_LEN } from './constants';

/** 复刻要求（独立卡）+ 放大编辑入口。 */
export function ViralCloneRequirementCard({
  requirement,
  onRequirementChange,
  onExpand,
}: {
  requirement: string;
  onRequirementChange: (value: string) => void;
  onExpand: () => void;
}) {
  return (
    <section className="pk-config-card vc-requirement-card">
      <div className="pk-section">
        <strong className="pk-section-title">复刻要求</strong>
        <div className="pk-desc-editor">
          <textarea
            className="vc-requirement-textarea"
            rows={3}
            maxLength={MAX_REQUIREMENT_LEN}
            value={requirement}
            placeholder="例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。"
            onChange={(e) => onRequirementChange(e.target.value)}
          />
          <button
            type="button"
            className="pk-desc-expand"
            aria-label="放大编辑复刻要求"
            title="放大编辑"
            onClick={onExpand}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
