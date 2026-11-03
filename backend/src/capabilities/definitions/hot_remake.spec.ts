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

  it('明确商品素材与最后一张参考图的分工', () => {
    const prompt = HotRemake.buildPrompt(
      {
        ...base,
        degree: 'high_replica',
        requirement: '模特保持完全不变，文案统一用英文',
      },
      3,
    );

    expect(prompt).toContain('第 1-2 张为商品素材，最后 1 张为爆款参考图');
    expect(prompt).toContain('商品「蓝色手提包」（品牌 BrandX）');
    expect(prompt).toContain('不把参考图中的商品、品牌或价格信息带入结果');
    expect(prompt).toContain('接触阴影与场景光影一致');
    expect(prompt).toContain('用户复刻要求（优先逐条执行）：模特保持完全不变，文案统一用英文');
    expect(prompt).toContain('高度复刻参考图');
    expect(prompt).toContain('适配京东平台');
    expect(prompt).toContain('画面内文字使用 English');
  });

  it('参考风格允许重建场景，与高度复刻形成明确差异', () => {
    const style = HotRemake.buildPrompt({ ...base, degree: 'reference_style' }, 2);
    const replica = HotRemake.buildPrompt({ ...base, degree: 'high_replica' }, 2);

    expect(style).toContain('允许调整背景和道具');
    expect(style).not.toContain('保持构图、透视、主体位置与占比');
    expect(replica).toContain('保持构图、透视、主体位置与占比');
    expect(replica).not.toContain('允许调整背景和道具');
  });

  it('两张输入时用自然表述说明素材顺序', () => {
    const prompt = HotRemake.buildPrompt({ ...base, degree: 'reference_style' }, 2);

    expect(prompt).toContain('共上传 2 张图：第 1 张为商品素材，最后 1 张为爆款参考图');
    expect(prompt).not.toContain('第 1-1 张');
  });

  it('未填写名称、品牌和要求时不制造空约束', () => {
    const prompt = HotRemake.buildPrompt(
      { productName: '  ', brand: '\t', degree: 'high_replica', requirement: '  ' },
      2,
    );

    expect(prompt).toContain('商品主体');
    expect(prompt).not.toContain('品牌 ');
    expect(prompt).not.toContain('用户复刻要求（优先逐条执行）');
  });
});
