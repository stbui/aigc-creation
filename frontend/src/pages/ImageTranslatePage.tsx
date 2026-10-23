import { useState } from 'react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { ToolCard, ToolSwitch } from '../components/ToolWidgets';
import { languageOptions } from '../lib/optionSets';

/**
 * 图片翻译 —— 1:1 复刻参考站 https://ijihua.cn/image-translate。
 *
 * 实拍结构 (image-translate-page):
 *   上传卡: * 上传图片
 *   翻译语言卡 (image-translate-settings):
 *     目标语言 select 10 项 (默认简体中文): 简体中文/English/Русский/Español/
 *       Deutsch/日本語/한국어/Português/Bahasa Indonesia/ไทย
 *     保护商品主体: role=switch, 默认开 (aria-checked=true)
 *   高级设置: 仅"画质 1K" (参考站该页无比例档位, 翻译保持原图比例)
 *   提交: 立即翻译 (消耗价由后端下发); 提示行 "* 确认素材和参数后提交，右侧会展示翻译结果。"
 *   描述: 智能翻译图片文字，保留原版式快速本地化
 *
 * 诚实披露: image_translate 必须由真实多模态 / 图像模型完成, 本地**没有实现**
 * (能力定义里 localFallback: false)。没有可用模型通道时后端判 failed/42204 并退款,
 * 本页据 runtime 提前禁用提交并说明原因, 不交付任何占位图。
 */

export function ImageTranslatePage() {
  const { submitting, result, run } = useToolTask({ capability: 'image_translate', successMessage: '翻译结果已生成' });

  const [targetLang, setTargetLang] = useState('zh-CN');
  const [protect, setProtect] = useState(true);

  return (
    <ToolShell
      capability="image_translate"
      title="图片翻译"
      desc="智能翻译图片文字，保留原版式快速本地化"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ resolution: true }}
      submitLabel="立即翻译"
      hint="* 确认素材和参数后提交，右侧会展示翻译结果。"
      emptyDesc="上传图片后，翻译结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={languageOptions().find((l) => l.value === targetLang)?.label}
      onSubmit={(inputs, settings) =>
        run(inputs, { targetLang, protectSubject: protect, size: settings.resolution })
      }
    >
      <ToolCard title="翻译语言">
        <label className="image-translate-language-field">
          <span>目标语言</span>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {languageOptions().map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <ToolSwitch label="保护商品主体" checked={protect} onChange={setProtect} />
      </ToolCard>
    </ToolShell>
  );
}
