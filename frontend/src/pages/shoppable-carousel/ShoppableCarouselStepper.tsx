import { Minus, Plus } from 'lucide-react';

import { MAX_COUNT, MIN_COUNT } from './constants';

/**
 * 生成张数步进器。
 *
 * 位置对齐参考站实拍：步进器在左栏**最底部、主按钮的正上方**，
 * 而不是配置卡片里的一项 —— 参考站的「张数 热门图文多为 6 张 − 6 +」
 * 与「生成带货图文」按钮同属提交区（`docs/shoppable-carousel-design.md` §4）。
 *
 * 取值范围 6–10（参考站实测：减号在 6 时禁用、加号在 10 时禁用）。
 */
export function ShoppableCarouselStepper({
  count,
  onCountChange,
}: {
  count: number;
  onCountChange: (value: number) => void;
}) {
  return (
    <div className="sc-count-row">
      <span className="sc-count-label">
        张数
        {/* 参考站原文「热门图文多为 6 张」; 本站底栏同一行还放了高级设置入口,
            全量文案会被挤成省略号, 故收成同义的短版。 */}
        <small>多为 6 张</small>
      </span>
      <div className="pk-number-control">
        <button
          type="button"
          aria-label="减少张数"
          disabled={count <= MIN_COUNT}
          onClick={() => onCountChange(Math.max(MIN_COUNT, count - 1))}
        >
          <Minus size={13} />
        </button>
        <input
          type="number"
          min={MIN_COUNT}
          max={MAX_COUNT}
          value={count}
          aria-label="生成张数"
          onChange={(e) => {
            const n = Number(e.target.value);
            onCountChange(
              Number.isFinite(n)
                ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(n)))
                : MIN_COUNT,
            );
          }}
        />
        <button
          type="button"
          aria-label="增加张数"
          disabled={count >= MAX_COUNT}
          onClick={() => onCountChange(Math.min(MAX_COUNT, count + 1))}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
