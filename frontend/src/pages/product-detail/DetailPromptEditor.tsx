import { memo } from 'react';

import { MAX_SECTION_PROMPT_LEN, SECTION_MODULES } from './constants';
import { Textarea } from '../../ui';

/**
 * 商品详情图「各模块画面要求」编辑器。
 *
 * 一次提交会按已选模块拆成多张独立图片；每个模块只读取属于自己的补充要求。
 * 用户写的是画面补充要求，不必重复商品信息、参考图和尺寸 ——
 * 服务端会把它与固定版式、商品事实和交付约束合并成一条完整提示词。
 * 这里始终按模块固定顺序渲染，避免用户勾选顺序影响要求与结果的对应关系。
 */

interface DetailPromptEditorProps {
  selected: string[];
  prompts: Record<string, string>;
  onChange: (value: string, prompt: string) => void;
}

function DetailPromptEditorBase({ selected, prompts, onChange }: DetailPromptEditorProps) {
  if (selected.length === 0) return null;
  const modules = SECTION_MODULES.filter((module) => selected.includes(module.value));
  const configured = modules.filter((module) => prompts[module.value]?.trim()).length;

  return (
    <section className="pk-config-card pd-prompt-card" aria-labelledby="pd-prompt-title">
      <div className="pk-section">
        <div className="pk-section-title-row">
          <strong className="pk-section-title" id="pd-prompt-title">
            各模块画面要求
          </strong>
          <span className="pk-section-counter">
            已填写 {configured}/{modules.length}
          </span>
        </div>
        <p className="pd-prompt-intro">
          勾选几个模块就生成几张图。每个模块单独写下想要的画面即可，
          商品信息、参考图和尺寸会自动带入。
        </p>
        <div className="pd-prompt-list">
          {modules.map((module, index) => (
            <label className="pd-prompt-item" key={module.value}>
              <span className="pd-prompt-item-head">
                <span>
                  <strong>{index + 1}. {module.label}</strong>
                  <small>{module.desc}</small>
                </span>
                <span className="pd-prompt-count">
                  {(prompts[module.value] ?? '').length}/{MAX_SECTION_PROMPT_LEN}
                </span>
              </span>
              <Textarea
                rows={2}
                maxLength={MAX_SECTION_PROMPT_LEN}
                value={prompts[module.value] ?? ''}
                placeholder="例如：构图、场景或需要突出的重点"
                aria-label={`${module.label}画面要求`}
                onChange={(event) => onChange(module.value, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 页面输入框每次按键都会重渲染；已选模块和要求不变时无需重建整张编辑器。 */
export const DetailPromptEditor = memo(DetailPromptEditorBase);
