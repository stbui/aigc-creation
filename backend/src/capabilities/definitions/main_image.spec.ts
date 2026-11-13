import { describe, expect, it } from 'vitest';

import { MainImage, mainImageVariantBrief, parseMainImageVariants } from './main_image';
import { MAIN_IMAGE_VARIANTS } from './param-options';

/**
 * 商品主图提示词 —— 锁住「变体必须进入提示词」这条不变量。
 *
 * ## 为什么这些断言是刚性的
 *
 * `variant` 过去只参与任务参数与结果标签，从未进入提示词 ——
 * 白底图 / 场景图 / 卖点图三次生成发给模型的是**完全相同**的一条指令，
 * 产出的三张图明显趋同，用户拿到的是「同一张图的三次复制」。
 *
 * 因此这里不只断言「提示词里提到了变体」，而是断言：
 *   1. 每类变体的提示词**互不相同**；
 *   2. 每类提示词**只要求画自己那一类**（不要求同时出三类）；
 *   3. 每类都有**互斥**的画面要求（白底 vs 场景 vs 卖点）。
 */

const base = {
  productName: '轻音桌面循环扇',
  brand: '清风',
  platform: 'taobao',
  language: 'zh-CN',
  description: '三档风速，低噪运行，USB 供电',
  ratio: '1:1',
  size: '1k',
};

const LABEL_OF: Record<string, string> = {
  white_background: '白底图',
  scene: '场景图',
  selling_point: '卖点图',
  other: '其他图',
};

describe('main_image 变体 → 提示词', () => {
  it('四类变体的提示词互不相同', () => {
    const prompts = MAIN_IMAGE_VARIANTS.map((option) =>
      MainImage.buildPrompt({ ...base, variant: String(option.value) }, 1),
    );
    expect(new Set(prompts).size).toBe(MAIN_IMAGE_VARIANTS.length);
  });

  it('白底图要求纯白背景，且不要求同时生成其它类型', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'white_background' }, 1);

    expect(prompt).toContain('本次只生成「白底图」这一张主图');
    expect(prompt).toContain('纯白无缝背景');
    expect(prompt).not.toContain('场景图');
    expect(prompt).not.toContain('卖点图');
  });

  it('场景图要求真实消费场景，且不要求同时生成其它类型', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'scene' }, 1);

    expect(prompt).toContain('本次只生成「场景图」这一张主图');
    expect(prompt).toContain('真实可感的消费场景');
    expect(prompt).not.toContain('白底图');
    expect(prompt).not.toContain('卖点图');
  });

  it('卖点图要求一张图讲清一个卖点，且不要求同时生成其它类型', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'selling_point' }, 1);

    expect(prompt).toContain('本次只生成「卖点图」这一张主图');
    expect(prompt).toContain('一张图讲清一个卖点');
    expect(prompt).not.toContain('白底图');
    expect(prompt).not.toContain('场景图');
  });

  it('未知变体回落到通用要求，但标签原样显示不吞信息', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'custom_variant' }, 1);

    expect(prompt).toContain('本次只生成「custom_variant」这一张主图');
    expect(prompt).toContain(mainImageVariantBrief('other'));
  });

  it('画面要求互斥：三类主图的构图与背景指令不串线', () => {
    const white = MainImage.buildPrompt({ ...base, variant: 'white_background' }, 1);
    const scene = MainImage.buildPrompt({ ...base, variant: 'scene' }, 1);
    const selling = MainImage.buildPrompt({ ...base, variant: 'selling_point' }, 1);

    // 白底图不谈场景，场景图不谈纯白背景，卖点图不谈纯白背景
    expect(white).not.toContain('消费场景');
    expect(scene).not.toContain('纯白无缝背景');
    expect(selling).not.toContain('纯白无缝背景');
  });
});

describe('main_image 文案闭集', () => {
  it('商品事实只注入一次，来源标签不会被要求写进画面', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'selling_point' }, 1);
    const facts = '三档风速，低噪运行，USB 供电';

    expect(prompt.split(facts)).toHaveLength(2);
    expect(prompt).toContain('“商品名称”“品牌”“商品事实”只是来源标签，不得原样写入画面');
  });

  it('未提供品牌与描述时不产生空事实或空括号', () => {
    const prompt = MainImage.buildPrompt(
      { ...base, brand: '', description: '', variant: 'selling_point' },
      1,
    );

    expect(prompt).not.toContain('（品牌');
    expect(prompt).not.toContain('商品事实：；');
    expect(prompt).not.toContain('品牌「');
    // 商品名称仍在闭集里 —— 它是唯一可写的素材
    expect(prompt).toContain('商品名称「轻音桌面循环扇」');
  });

  it('三项素材全空时明确禁字，不允许模型自行编造文案', () => {
    const prompt = MainImage.buildPrompt(
      { ...base, productName: '', brand: '', description: '', variant: 'selling_point' },
      1,
    );

    expect(prompt).toContain('用户未提供商品文案素材');
    expect(prompt).not.toContain('品牌「');
    expect(prompt).not.toContain('商品事实：');
  });

  it('非卖点图一律禁字，不给模型「可以写点字」的余地', () => {
    for (const variant of ['white_background', 'scene', 'other']) {
      const prompt = MainImage.buildPrompt({ ...base, variant }, 1);
      expect(prompt).toContain('本图不写字');
      expect(prompt).not.toContain('画面文字只能取自以下素材');
    }
  });

  it('卖点图才允许写字，且限定在事实闭集内', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'selling_point' }, 1);

    expect(prompt).toContain('画面文字只能取自以下素材');
    expect(prompt).not.toContain('本图不写字');
  });

  it('禁止模型补写参数、功效、认证与促销承诺', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'selling_point' }, 1);

    expect(prompt).toContain('不得编造型号、材质、尺寸、参数、功效、认证、销量、价格、优惠或售后承诺');
  });
});

describe('main_image 规格与参考图', () => {
  it('平台、比例、画质与语言继续进入提示词', () => {
    const prompt = MainImage.buildPrompt({ ...base, variant: 'scene' }, 1);

    expect(prompt).toContain('画面比例 1:1');
    expect(prompt).toContain('输出规格 1K');
    expect(prompt).toContain('适配淘宝平台（主图常规 1:1、边长 ≥800px）');
    expect(prompt).toContain('画面内文字使用 简体中文');
  });

  it('有参考图时写明张数，没有时不写', () => {
    expect(MainImage.buildPrompt({ ...base, variant: 'scene' }, 2)).toContain(
      '共参考上传的 2 张商品图。',
    );
    expect(MainImage.buildPrompt({ ...base, variant: 'scene' }, 0)).not.toContain('【参考图】');
  });
});

describe('parseMainImageVariants', () => {
  it('按声明顺序展开计数，一类填几张就出现几次', () => {
    expect(
      parseMainImageVariants('white_background,scene,scene,selling_point,other,other,other'),
    ).toEqual([
      'white_background',
      'scene',
      'scene',
      'selling_point',
      'other',
      'other',
      'other',
    ]);
  });

  it('输入顺序被打乱，展开结果仍按声明顺序稳定', () => {
    expect(parseMainImageVariants('scene,white_background')).toEqual([
      'white_background',
      'scene',
    ]);
  });

  it('未知变体被过滤掉，不产生任务', () => {
    expect(parseMainImageVariants('white_background,bogus')).toEqual(['white_background']);
    expect(parseMainImageVariants('')).toEqual([]);
  });

  it('张数上限 20 张', () => {
    expect(parseMainImageVariants(new Array(50).fill('scene').join(','))).toHaveLength(20);
  });
});

describe('main_image outputPlan', () => {
  it('一次提交展开成 N 张，每张带自己的变体与标签', () => {
    const outputs = MainImage.outputPlan?.({
      ...base,
      variants: 'white_background,scene,scene',
    });

    expect(outputs?.map((output) => output.label)).toEqual(['白底图', '场景图', '场景图']);
    expect(outputs?.map((output) => output.params.variant)).toEqual([
      'white_background',
      'scene',
      'scene',
    ]);
    expect(outputs?.[0].params.variantLabel).toBe('白底图');
  });

  it('outputPlan 产出的每张图提示词互不相同', () => {
    const outputs = MainImage.outputPlan?.({
      ...base,
      variants: 'white_background,scene,selling_point',
    }) ?? [];
    const prompts = outputs.map((output) =>
      MainImage.buildPrompt({ ...base, ...output.params }, 1),
    );

    expect(prompts).toHaveLength(3);
    expect(new Set(prompts).size).toBe(3);
  });

  it('同一变体出多张时，提示词相同但键不同（各自独立成任务）', () => {
    const outputs = MainImage.outputPlan?.({ ...base, variants: 'scene,scene' }) ?? [];

    expect(outputs).toHaveLength(2);
    expect(new Set(outputs.map((output) => output.key)).size).toBe(2);
    const prompts = outputs.map((output) => MainImage.buildPrompt({ ...base, ...output.params }, 1));
    expect(new Set(prompts).size).toBe(1);
  });
});

describe('main_image 变体标签', () => {
  it('四个变体的标签与 param-options 一致', () => {
    expect(Object.keys(LABEL_OF).sort()).toEqual(MAIN_IMAGE_VARIANTS.map((o) => String(o.value)).sort());
  });
});
