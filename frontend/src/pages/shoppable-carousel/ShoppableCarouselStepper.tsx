import { Minus, Plus } from 'lucide-react';

/**
 * 生成张数步进器。
 *
 * 位置对齐参考站实拍：步进器在左栏**最底部、主按钮的正上方**，
 * 而不是配置卡片里的一项 —— 参考站的「张数 热门图文多为 6 张 − 6 +」
 * 与「生成带货图文」按钮同属提交区（`docs/shoppable-carousel-design.md` §4）。
 *
 * 区间由页面按后端 `GET /shoppable-carousel/templates` 的 `countRange`
 * 下发（参考站实测 6–10：减号在下界禁用、加号在上界禁用），
 * 组件自己不持有区间常量，避免与后端漂移。
 */
export function ShoppableCarouselStepper({
  count,
  min,
  max,
  onCountChange,
}: {
  count: number;
  min: number;
  max: number;
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
          disabled={count <= min}
          onClick={() => onCountChange(Math.max(min, count - 1))}
        >
          <Minus size={13} />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={count}
          aria-label="生成张数"
          onChange={(e) => {
            const n = Number(e.target.value);
            onCountChange(
              Number.isFinite(n)
                ? Math.min(max, Math.max(min, Math.round(n)))
                : min,
            );
          }}
        />
        <button
          type="button"
          aria-label="增加张数"
          disabled={count >= max}
          onClick={() => onCountChange(Math.min(max, count + 1))}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
