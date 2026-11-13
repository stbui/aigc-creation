import { memo } from 'react';
import { Checkbox } from '../../ui';
import { MAX_SECTIONS, SECTION_MODULES } from './constants';

/**
 * 商品详情图「包含模块」卡片 —— 16 项多选。
 *
 * 选项清单、顺序、默认勾选与上限都在 `./constants` (页面与任务参数的共同事实源);
 * 本组件只负责渲染与把勾选回调交给调用方。
 */

interface DetailSectionPickerProps {
  /** 已选模块 key, 顺序无意义 */
  selected: string[];
  /** 勾选 / 取消勾选; 上限判定与顺序归一化由调用方负责 (它持有状态) */
  onToggle: (value: string) => void;
}

/**
 * 模块多选卡片。
 *
 * `memo` 是必要的: 左栏的输入框每次按键都会重渲染整个页面, 而 16 个选项的
 * 选中态只随 `selected` 变化 —— 商品名称敲一个字不该连带重算整张选项表。
 */
function DetailSectionPickerBase({ selected, onToggle }: DetailSectionPickerProps) {
  const atLimit = selected.length >= MAX_SECTIONS;
  return (
    <section className="pk-config-card pk-detail-card">
      <div className="pk-section">
        <div className="pk-section-title-row">
          <strong className="pk-section-title u-font-14">包含模块（多选）</strong>
          <span className="pk-section-counter">
            已选 {selected.length}/{MAX_SECTIONS}
          </span>
        </div>
        <div className="pk-section-picker">
          {SECTION_MODULES.map((m) => {
            const checked = selected.includes(m.value);
            // 已选满时未选项置灰并给 hover 说明, 已选项仍可取消
            const locked = atLimit && !checked;
            return (
              <label
                key={m.value}
                className={`pk-section-option${checked ? ' pk-section-option-selected' : ''}${locked ? ' pk-section-option-limit' : ''}`}
                title={locked ? `最多选择 ${MAX_SECTIONS} 个模块` : undefined}
              >
                <Checkbox
                  className="pk-section-check"
                  checked={checked}
                  disabled={locked}
                  aria-label={m.label}
                  onChange={() => onToggle(m.value)}
                />
                <span>
                  <strong>{m.label}</strong>
                  <small>{m.desc}</small>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export const DetailSectionPicker = memo(DetailSectionPickerBase);
