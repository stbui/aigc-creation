import { Maximize2 } from 'lucide-react';

import { MAX_REQUIREMENT_LEN, REQUIREMENT_PLACEHOLDER } from './constants';
import { SectionCard, Textarea } from './components';

/**
 * 复刻要求（独立配置卡）+ 放大编辑入口。
 *
 * 卡片外壳与标题行走 `SectionCard`，标签仍是 `<label>`（点击标题可聚焦文本域）。
 * 文本域皮肤与商品主图 / 商品详情的「商品描述」同源（`.pk-desc-editor` +
 * `.pk-desc-expand`）：同一块左栏里出现两种圆角与内边距的文本域，视觉上会
 * 显得像两套组件。
 */
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
    <SectionCard title={<label htmlFor="vc-requirement">复刻要求</label>}>
      <div className="pk-desc-editor">
        <Textarea
          id="vc-requirement"
          className="field-sizing-fixed"
          rows={3}
          maxLength={MAX_REQUIREMENT_LEN}
          value={requirement}
          placeholder={REQUIREMENT_PLACEHOLDER}
          onChange={(event) => onRequirementChange(event.target.value)}
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
    </SectionCard>
  );
}
