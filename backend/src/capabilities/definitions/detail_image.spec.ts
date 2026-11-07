import { describe, expect, it } from 'vitest';

import { DetailImage } from './detail_image';
import { DETAIL_SECTIONS } from './param-options';
import { imageOptions } from '../model-mapping';

const base = {
  productName: '轻音桌面循环扇',
  brand: '清风',
  platform: 'taobao',
  language: 'zh-CN',
  description: '三档风速，低噪运行，USB 供电；扇叶直径 18cm。',
  ratio: '3:4',
  size: '2k',
};

describe('detail_image 提示词', () => {
  it('每个模块都生成独立版式，模块名只出现一次', () => {
    const requiredParts = [
      '【任务】',
      '【模块任务与画面要求】',
      '【参考图】',
      '【视觉系统】',
      '【本图允许文案】',
      '【文案规则】',
      '【文字呈现】',
      '【尺寸与交付】',
      '【输出】',
    ];
    const prompts = DETAIL_SECTIONS.map(({ value, label }) => {
      const prompt = DetailImage.buildPrompt({ ...base, section: value }, 1);

      expect(prompt).toContain(`只生成「${label}」这一张独立版块图`);
      expect(prompt.split(`「${label}」`)).toHaveLength(2);
      requiredParts.forEach((part) => expect(prompt).toContain(part));
      DETAIL_SECTIONS.filter((section) => section.value !== value).forEach((section) => {
        expect(prompt).not.toContain(`「${section.label}」`);
      });
      return prompt;
    });

    expect(new Set(prompts).size).toBe(DETAIL_SECTIONS.length);
  });

  it('事实型模块要求只使用描述中有依据的数据', () => {
    const prompt = DetailImage.buildPrompt({ ...base, section: 'spec_table' }, 1);

    expect(prompt).toContain('商品事实：三档风速，低噪运行，USB 供电；扇叶直径 18cm。');
    expect(prompt).toContain('字段和数值仅从商品事实提取，缺项直接删行');
    expect(prompt).toContain('不得补写未提供的型号、材质、尺寸、参数、认证、销量、价格、优惠或售后承诺');
    expect(prompt).toContain('信息不足时减少信息项');
    expect(prompt).toContain('适配淘宝平台（详情长图建议宽度 750px）');
    expect(prompt).toContain('画面比例：3:4');
    expect(prompt).toContain('输出画质：2K');
    expect(prompt).toContain('该宽度只用于生成后的缩放或裁切，不作为模型输出画质');
    expect(prompt).toContain('画面内文字使用 简体中文');
  });

  it('商品事实只注入一次，来源标签不会被要求写进画面', () => {
    const prompt = DetailImage.buildPrompt({ ...base, section: 'selling_points' }, 1);
    const factText = '三档风速，低噪运行，USB 供电；扇叶直径 18cm';

    expect(prompt.split(factText)).toHaveLength(2);
    expect(prompt).toContain('“商品名称”“品牌”“商品事实”只是来源标签，不得原样写入画面');
    expect(prompt).toContain('只能对上述素材做不改变含义的压缩，或按目标语言做等价翻译');
    expect(prompt).not.toContain(`电商详情页单模块图生成。商品「轻音桌面循环扇」（品牌 清风）。商品事实：`);
  });

  it('参考图只约束商品外观，不携带原图版式和文字', () => {
    const prompt = DetailImage.buildPrompt({ ...base, section: 'usage_scene' }, 1);

    expect(prompt).toContain('参考图仅作为商品外观依据，不是版式、场景或文案参考');
    expect(prompt).toContain('商品结构、颜色、材质、logo、包装和配件必须与参考图一致');
    expect(prompt).toContain('不复制参考图的背景、桌面、人物、构图、文字、水印和拍摄角度');
  });

  it('每个模块都把固定版式与补充要求合并成一条完整、互不串线的提示词', () => {
    const modules = [
      { section: 'hero', prompt: '首屏标题更醒目，商品居中并保留右侧留白' },
      { section: 'selling_points', prompt: '用三张图标卡片展示三个核心卖点' },
      { section: 'usage_scene', prompt: '放在清晨的书桌场景中' },
      { section: 'multi_angle', prompt: '展示正面、侧面和俯视三个角度' },
      { section: 'scene_atmosphere', prompt: '使用柔和自然光' },
      { section: 'product_detail', prompt: '重点表现扇叶纹理' },
    ];
    const outputs = DetailImage.outputPlan?.({
      ...base,
      sections: modules.map((item) => item.section).join(','),
      sectionPrompts: JSON.stringify(modules),
    });

    expect(outputs?.map((output) => output.params.sectionPrompt)).toEqual(
      modules.map((item) => item.prompt),
    );

    const prompts = outputs?.map((output) => DetailImage.buildPrompt({ ...base, ...output.params }, 1)) ?? [];
    expect(prompts).toHaveLength(modules.length);
    expect(new Set(prompts).size).toBe(modules.length);

    prompts.forEach((prompt, index) => {
      expect(prompt).toContain('【模块任务与画面要求】');
      expect(prompt).toContain(`本模块补充要求：${modules[index].prompt}`);
      expect(prompt).toContain('默认版式仅补充未被明确覆盖的部分');
      expect(prompt).not.toContain('【模块提示词】');
      expect(prompt).not.toContain('以上模块提示词用于补充');

      modules.forEach((other, otherIndex) => {
        if (otherIndex === index) return;
        expect(prompt).not.toContain(other.prompt);
      });
    });
  });

  it('模块提示词缺失或格式非法时回落到固定版式说明', () => {
    const outputs = DetailImage.outputPlan?.({
      ...base,
      sections: 'hero',
      sectionPrompts: '{not-json',
    });
    expect(outputs?.[0].params.sectionPrompt).toBeUndefined();
    const prompt = DetailImage.buildPrompt({ ...base, ...outputs?.[0].params }, 1);
    expect(prompt).toContain('【模块任务与画面要求】');
    expect(prompt).not.toContain('本模块补充要求');
    expect(prompt).toContain('以上约束构成同一张图的完整执行指令');
  });

  it('画面文案限定为商品名称、品牌和商品事实的闭集', () => {
    const prompt = DetailImage.buildPrompt({ ...base, section: 'selling_points' }, 1);

    expect(prompt).toContain('本图允许文案');
    expect(prompt).toContain(
      '画面文字只能取自以下素材；“商品名称”“品牌”“商品事实”只是来源标签，不得原样写入画面：商品名称「轻音桌面循环扇」；品牌「清风」；商品事实：',
    );
    expect(prompt).toContain('除压缩或翻译后的素材外，不生成任何文字、数字、标签或水印');
  });

  it('缺少品牌与效果事实时，模块不得编造品牌故事或前后对比', () => {
    const brandPrompt = DetailImage.buildPrompt(
      { ...base, brand: '', section: 'brand_story' },
      1,
    );
    const comparePrompt = DetailImage.buildPrompt(
      { ...base, description: '商品为单色哑光材质', section: 'effect_compare' },
      1,
    );

    expect(brandPrompt).toContain('没有品牌信息时只表现商品名称和产品设计语言');
    expect(brandPrompt).not.toContain('没有品牌主张时只表现品牌名');
    expect(comparePrompt).toContain('缺少前后差异事实时改为单一使用效果展示，不虚构对照结果');
  });

  it('缺少工艺事实时改用可见材质展示，不虚构生产步骤', () => {
    const prompt = DetailImage.buildPrompt({ ...base, section: 'craft_process' }, 1);

    expect(prompt).toContain('仅当商品事实明确提供工艺步骤时，展示 2-4 个对应步骤');
    expect(prompt).toContain('否则不生成步骤图，改为展示参考图中真实可见的材质细节和制作氛围');
    expect(prompt).toContain('不虚构工序、设备、工厂或生产环节');
  });

  it('缺少成分事实时不生成成分列表或虚构功效', () => {
    const prompt = DetailImage.buildPrompt({ ...base, section: 'ingredients' }, 1);

    expect(prompt).toContain('仅当商品事实明确提供成分或配方时，将对应内容做成信息图');
    expect(prompt).toContain('缺少成分或配方事实时不生成成分列表或配方图');
    expect(prompt).toContain('不虚构成分、比例、功效、来源或认证');
  });

  it('未填写描述和品牌时不制造空事实或空品牌约束', () => {
    const prompt = DetailImage.buildPrompt(
      { ...base, brand: '', description: '  ', section: 'hero' },
      1,
    );

    expect(prompt).toContain('仅根据商品名称与参考图呈现商品外观，不补充参数事实');
    expect(prompt).not.toContain('（品牌');
    expect(prompt).toContain('只生成「首屏主视觉」这一张独立版块图');
  });

  it('比例与画质是两个独立参数', () => {
    const description = DetailImage.params.find((param) => param.key === 'description');
    const ratio = DetailImage.params.find((param) => param.key === 'ratio');
    const size = DetailImage.params.find((param) => param.key === 'size');

    expect(description).toMatchObject({ label: '商品描述', maxLength: 5000 });
    expect(ratio).toMatchObject({ label: '画面比例', default: '3:4' });
    expect(ratio?.options?.map((option) => option.value)).toEqual(['3:4', '4:5', '1:1', '9:16']);
    expect(size).toMatchObject({ label: '输出画质', default: '1k' });
  });

  it('比例和画质分别进入模型请求意图', () => {
    expect(imageOptions({ ratio: '4:5', size: '2k' })).toEqual({
      size: '4:5',
      imageResolution: '2k',
    });
  });
});
