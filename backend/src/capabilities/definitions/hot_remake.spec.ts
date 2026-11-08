import { describe, expect, it } from 'vitest';

import { HotRemake } from './hot_remake';

describe('hot_remake 提示词', () => {
  const base = {
    productName: '蓝色手提包',
    brand: 'BrandX',
    platform: 'jd',
    language: 'en-US',
    ratio: '1:1',
    size: '1k',
  };

  it('明确商品素材、参考图分工和硬约束', () => {
    const prompt = HotRemake.buildPrompt(
      {
        ...base,
        degree: 'high_replica',
        requirement: '把比例改成 9:16，背景换成粉色',
      },
      3,
    );

    expect(prompt).toContain('第 1-2 张仅用于确认商品身份，最后 1 张仅作为构图');
    expect(prompt).toContain('商品「蓝色手提包」（品牌 BrandX）');
    expect(prompt).toContain('不得复刻参考图中的任何商品、可识别人物及面部');
    expect(prompt).toContain('不得为了匹配参考图对商品进行拉伸、压扁、补造结构或改变比例');
    expect(prompt).toContain('接触阴影和场景光影一致');
    expect(prompt).toContain('不新增价格、优惠、参数、功效、认证、销量、评价、售后承诺或行动号召');
    expect(prompt).toContain('参考图原有文字一律不复刻');
    expect(prompt).toContain('在不违反上述商品一致性、参考图边界、目标比例和平台规范的前提下执行');
    expect(prompt).toContain('高度复刻：保持参考图的构图');
    expect(prompt).toContain('适配京东平台');
    expect(prompt).toContain('画面内文字使用 English');
  });

  it('参考风格允许重建场景，与高度复刻形成明确差异', () => {
    const style = HotRemake.buildPrompt({ ...base, degree: 'reference_style' }, 2);
    const replica = HotRemake.buildPrompt({ ...base, degree: 'high_replica' }, 2);

    expect(style).toContain('允许调整背景和道具');
    expect(style).toContain('保持信息层级、视觉重心和商品调性一致');
    expect(style).not.toContain('保持参考图的构图、透视');
    expect(replica).toContain('保持参考图的构图、透视、画面重心、背景关系、光影、色调和留白区');
    expect(replica).toContain('不得变形商品，也不得改变整体版式关系');
    expect(replica).not.toContain('允许调整背景和道具');
  });

  it('目标比例是硬约束，参考图比例不同时需要重新构图而不是拉伸', () => {
    const prompt = HotRemake.buildPrompt({ ...base, ratio: '16:9', degree: 'high_replica' }, 2);

    expect(prompt).toContain('输出比例 16:9 是硬约束');
    expect(prompt).toContain('以目标比例为优先');
    expect(prompt).toContain('不拉伸商品和背景');
    expect(prompt).toContain('画面比例 16:9');
  });

  it('两张输入时用自然表述说明素材顺序', () => {
    const prompt = HotRemake.buildPrompt({ ...base, degree: 'reference_style' }, 2);

    expect(prompt).toContain('共上传 2 张图：第 1 张仅用于确认商品身份');
    expect(prompt).not.toContain('第 1-1 张');
  });

  it('文案只允许来自商品信息或用户明确指定的内容', () => {
    const prompt = HotRemake.buildPrompt({ ...base, degree: 'high_replica' }, 2);

    expect(prompt).toContain('仅允许使用商品名称「蓝色手提包」、品牌「BrandX」');
    expect(prompt).toContain('用户在复刻要求中明确指定为画面文案的内容');
    expect(prompt).toContain('商品包装和标签上的原有文字保持素材原样');
  });

  it('未填写名称、品牌和要求时不制造空约束或空文案', () => {
    const prompt = HotRemake.buildPrompt(
      { productName: '  ', brand: '\t', degree: 'high_replica', requirement: '  ' },
      2,
    );

    expect(prompt).toContain('商品主体');
    expect(prompt).toContain('仅允许使用用户在复刻要求中明确指定为画面文案的内容');
    expect(prompt).not.toContain('商品名称「」');
    expect(prompt).not.toContain('品牌「」');
    expect(prompt).not.toContain('【用户附加要求】');
  });
});
