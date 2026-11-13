import { describe, expect, it } from 'vitest';

import { AppError } from '../common/app.exception';
import { PromptPreviewService } from './prompt-preview.service';

/**
 * 提示词预览 —— 锁住「预览与真实提交不可能漂移」这条不变量。
 *
 * 预览的价值完全建立在可信上：如果预览显示的提示词与实际发给模型的
 * 不一样，用户就是按错误信息在做决策，比没有预览更糟。
 *
 * 因此这里的断言不是「预览里有某句话」，而是：
 *   1. 预览走的是**能力自己的** `buildPrompt` / `outputPlan`；
 *   2. 预览的张数与顺序与真实提交拆出的任务一致；
 *   3. 参数按**同一套**校验与收敛处理。
 */

const service = new PromptPreviewService();

const base = {
  productName: '轻音桌面循环扇',
  brand: '清风',
  platform: 'taobao',
  language: 'zh-CN',
  description: '三档风速，低噪运行，USB 供电',
  ratio: '1:1',
  size: '1k',
};

describe('PromptPreviewService', () => {
  it('未知能力返回 40001', () => {
    expect(() => service.preview('no_such_capability')).toThrow(AppError);
    try {
      service.preview('no_such_capability');
    } catch (error) {
      expect((error as AppError).code).toBe(40001);
    }
  });

  it('单图能力返回一条提示词', () => {
    const result = service.preview('main_image', { ...base, variant: 'white_background' }, 1);

    expect(result.capability).toBe('main_image');
    expect(result.outputCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].prompt).toContain('纯白无缝背景');
  });

  it('主图按变体计数展开成多条，且每条提示词互不相同', () => {
    const result = service.preview('main_image', {
      ...base,
      variants: 'white_background,scene,scene,selling_point',
    });

    expect(result.outputCount).toBe(4);
    expect(result.items.map((item) => item.label)).toEqual([
      '白底图',
      '场景图',
      '场景图',
      '卖点图',
    ]);
    // 四张里只有两张是「场景图」，另两张互不相同
    expect(new Set(result.items.map((item) => item.prompt)).size).toBe(3);
  });

  it('预览顺序与 outputPlan 一致（与真实提交拆出的任务顺序相同）', () => {
    const result = service.preview('main_image', {
      ...base,
      variants: 'selling_point,white_background',
    });

    expect(result.items.map((item) => item.label)).toEqual(['白底图', '卖点图']);
  });

  it('参考图张数进入提示词，与真实链路同源', () => {
    const result = service.preview('main_image', { ...base, variant: 'scene' }, 3);

    expect(result.items[0].prompt).toContain('共参考上传的 3 张商品图。');
  });

  it('非法枚举被拒（与真实提交的校验一致）', () => {
    expect(() =>
      service.preview('main_image', { ...base, platform: 'not_a_platform' }),
    ).toThrow(AppError);
  });

  it('未知的主图变体清单被拒，不会静默出一张别的图', () => {
    expect(() =>
      service.preview('main_image', { ...base, variants: 'white_background,bogus' }),
    ).toThrow(AppError);
  });

  it('缺省参数按能力声明补默认值，隐藏技术字段不被凭空注入', () => {
    const result = service.preview('main_image', { productName: '循环扇' });

    // 普通参数补默认值
    expect(result.params.platform).toBe('taobao');
    expect(result.params.language).toBe('zh-CN');
    // 隐藏的批次技术字段不应被默认值污染
    expect(result.params.batchId).toBeUndefined();
    expect(result.params.batchIndex).toBeUndefined();
  });

  it('详情图按模块展开，与真实提交的张数一致', () => {
    const result = service.preview('detail_image', {
      ...base,
      sections: 'hero,selling_points,usage_scene',
    });

    expect(result.outputCount).toBe(3);
    expect(result.items.map((item) => item.label)).toEqual([
      '首屏主视觉',
      '核心卖点图',
      '使用场景图',
    ]);
  });

  it('预览不产生任何副作用：同一份参数重复预览结果一致', () => {
    const first = service.preview('main_image', { ...base, variants: 'scene,scene' });
    const second = service.preview('main_image', { ...base, variants: 'scene,scene' });

    expect(first.items.map((item) => item.prompt)).toEqual(second.items.map((item) => item.prompt));
  });
});
