import { memo } from 'react';

import { MAX_SECTION_PROMPT_LEN, SECTION_MODULES } from './constants';
import { Textarea } from '../../ui';

/**
 * 商品详情图「模块提示词」编辑器。
 *
 * 一次提交会按已选模块拆成多个独立任务；每个任务只读取属于自己的提示词。
 * 这里始终按模块固定顺序渲染，避免用户勾选顺序影响提示词与结果的对应关系。
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
            模块提示词
          </strong>
          <span className="pk-section-counter">
            已配置 {configured}/{modules.length}
          </span>
        </div>
        <p className="pd-prompt-intro">
          一个模块对应一个提示词。点击立即生成后，各模块会作为独立任务并发提交。
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
                placeholder={`请输入「${module.label}」的提示词`}
                aria-label={`${module.label}提示词`}
                onChange={(event) => onChange(module.value, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 页面输入框每次按键都会重渲染；已选模块和提示词不变时无需重建整张编辑器。 */
export const DetailPromptEditor = memo(DetailPromptEditorBase);
