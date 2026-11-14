import { describe, expect, it } from 'vitest';

import { Matting } from './matting';

/**
 * 一键抠图提示词回归。此前该能力只有 verify-tool-contracts.ts 里的参数级
 * 断言，提示词把背景色 token 名与前端 canvas 的 alpha 当画面指令发给模型，
 * 换背景色就会改变实发文本 —— 与「模型只出透明主体、浏览器合成背景」的
 * 分工冲突。这里固化分工边界与电商硬约束，避免文案改动静默退化。
 */
describe('matting 提示词', () => {
  const page = {
    selectedColor: 'transparent',
    customColor: '#5546D8',
    customAlpha: 100,
    ratio: 'original',
    resolution: '1k',
  };

  it('背景色 / 自定义透明度只用于前端合成，不改变实发提示词', () => {
    const baseline = Matting.buildPrompt(page, 1);
    const variants = [
      { ...page, selectedColor: 'white' },
      { ...page, selectedColor: 'light-blue' },
      { ...page, selectedColor: 'blue' },
      { ...page, selectedColor: 'red' },
      { ...page, selectedColor: 'dark-red' },
      { ...page, selectedColor: 'custom', customColor: '#FF0000', customAlpha: 72 },
      { bgColor: '#3988E9' },
      { selectedColor: 'pink' },
      {},
    ];

    for (const params of variants) {
      expect(Matting.buildPrompt(params, 1)).toBe(baseline);
    }
  });

  it('不把色名、HEX、透明度或未知枚举当成画面指令', () => {
    const prompt = Matting.buildPrompt({ selectedColor: 'pink', customAlpha: 0, customColor: '#FF0000' }, 1);

    expect(prompt).not.toContain('背景替换为');
    expect(prompt).not.toContain('色板');
    expect(prompt).not.toContain('pink');
    expect(prompt).not.toContain('light-blue');
    expect(prompt).not.toContain('#FF0000');
    expect(prompt).not.toContain('72%');
    expect(prompt).not.toContain('%');
  });

  it('透明底与 Alpha 边缘要求显式，不留原背景残影', () => {
    const prompt = Matting.buildPrompt(page, 1);

    expect(prompt).toContain('带 Alpha 通道的透明背景图');
    expect(prompt).toContain('主体外区域完全透明，不绘制任何背景、底色、投影或场景');
    expect(prompt).toContain('边缘发丝级保留');
    expect(prompt).toContain('不留白边、黑边、锯齿、光晕或原背景残影');
  });

  it('商品一致性硬约束复用主图 / SKU / 换色口径', () => {
    const prompt = Matting.buildPrompt(page, 1);

    expect(prompt).toContain('数量、部件与结构、颜色、材质纹理、图案、logo、包装、视角、姿态与遮挡关系全部与输入图一致');
    expect(prompt).toContain('不得重绘、替换、拉伸变形或增删部件');
    expect(prompt).toContain('不得新增、移除或替换任何物体');
  });

  it('文字 / 品牌策略显式，禁编事实与装饰性假文案', () => {
    const prompt = Matting.buildPrompt(page, 1);

    expect(prompt).toContain('不重写、不翻译、不美化、不遮挡');
    expect(prompt).toContain('不新增价格、优惠、销量、认证、功效、参数、品牌标识或行动号召');
    expect(prompt).toContain('成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案');
  });

  it('参考图只作主体依据，张数由 refCount 显式进入提示词', () => {
    const prompt = Matting.buildPrompt(page, 1);

    expect(prompt).toContain('参考图只作为主体外观与轮廓依据');
    expect(prompt).toContain('不复制参考图的背景、桌面、人物、构图与水印');
    expect(prompt).toContain('共参考上传的 1 张商品图。');

    const none = Matting.buildPrompt(page, 0);
    const three = Matting.buildPrompt(page, 3);
    expect(none).not.toContain('共参考上传的');
    expect(three).toContain('共参考上传的 3 张商品图。');
    expect(new Set([prompt, none, three]).size).toBe(3);
  });

  it('只输出一张透明底主体图，不产带色底图 / 拼图 / 对照图', () => {
    const prompt = Matting.buildPrompt(page, 1);

    expect(prompt).toContain('只输出一张透明底主体图');
    expect(prompt).toContain('不输出白底图、带色底图、拼图、前后对照图或多版本合集');
    expect(prompt).toContain('不把抠图结果放进任何新场景');
  });

  it('比例 / 画质 / 分辨率只走协议字段，不重复进提示词', () => {
    const prompt = Matting.buildPrompt({ ...page, ratio: '9:16', resolution: '4k', size: '4k' }, 1);

    expect(prompt).not.toContain('9:16');
    expect(prompt).not.toContain('4k');
    expect(prompt).not.toContain('original');
    expect(prompt).not.toContain('输出规格');
    expect(prompt).not.toContain('画面尺寸');
  });
});
