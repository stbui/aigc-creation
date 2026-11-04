import { describe, expect, it } from 'vitest';

import {
  SkuImage,
  parseSkuRegions,
  resolveSkuColor,
  type SkuRegionVariant,
} from './sku_image';

const regions = [
  { regionId: 'region-a', type: 'rect', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  { regionId: 'region-b', type: 'ellipse', x: 0.55, y: 0.1, width: 0.2, height: 0.25 },
];

function buildPrompt(
  overrides: Record<string, unknown> = {},
  refCount = 3,
  variants: SkuRegionVariant[] = [
    {
      regionId: 'region-a',
      instruction: '把区域 A 的商品颜色改成红色',
      referenceIndex: 2,
    },
    {
      regionId: 'region-b',
      instruction: '保持区域 B 的商品不变，只替换背景纹理',
      referenceIndex: 1,
    },
  ],
): string {
  return SkuImage.buildPrompt(
    {
      skuName: 'CLASSIC BLACK / M',
      skuColor: 'original',
      regions: JSON.stringify(regions),
      variants: JSON.stringify(variants),
      ratio: '1:1',
      size: '1k',
      ...overrides,
    },
    refCount,
  );
}

describe('sku_image 提示词', () => {
  it('明确模板图、变体参考图的输入分工和单图输出', () => {
    const prompt = buildPrompt({}, 3);

    expect(prompt).toContain('第 1 张是模板图');
    expect(prompt).toContain('第 2-3 张是变体参考图');
    expect(prompt).toContain('外观、颜色、材质、纹理、文字或背景信息');
    expect(prompt).toContain('不得把参考图整体套到模板上');
    expect(prompt).toContain('只输出当前 SKU 的一张完整成图');
    expect(prompt).toContain('不输出拼图、九宫格、批量预览、前后对照图或多版本合集');
  });

  it('按 regionId 映射区域要求，并把参考图序号换算成完整输入图序号', () => {
    const prompt = buildPrompt();

    expect(prompt).toMatch(
      /区域1｜矩形范围.*变化要求：把区域 A 的商品颜色改成红色.*仅参考输入图第 3 张/,
    );
    expect(prompt).toMatch(
      /区域2｜椭圆范围.*变化要求：保持区域 B 的商品不变，只替换背景纹理.*仅参考输入图第 2 张/,
    );
    expect(prompt).toContain('左10% 上20% 宽30% 高40%');
  });

  it('未指定颜色时保持模板原色，不把默认白色写进 SKU', () => {
    const prompt = buildPrompt({ skuColor: undefined });

    expect(prompt).toContain('保持模板中的原色');
    expect(prompt).not.toContain('#FFFFFF');
    expect(prompt).not.toContain('颜色 #FFFFFF');
  });

  it('显式指定颜色时只改变对应区域的指定属性', () => {
    const prompt = buildPrompt({ skuColor: '#112233' });

    expect(prompt).toContain('本任务指定的 SKU 颜色为 #112233');
    expect(prompt).toContain('不得把商品结构、材质或纹理简化成纯色色块');
  });

  it('锁定框外内容和商品身份，并禁止把 SKU 名称自动当作图中文字', () => {
    const prompt = buildPrompt();

    expect(prompt).toContain('框选范围是编辑上限');
    expect(prompt).toContain('不得把改动扩散到区域外');
    expect(prompt).toContain('不得整体调色、换背景、改镜头、改透视、改裁切、改画幅或重新排版');
    expect(prompt).toContain('不得拉伸、压扁或臆造不存在的细节');
    expect(prompt).toContain('不得根据 SKU 名称自动生成图中文字');
    expect(prompt).toContain('不复制参考图中的水印、二维码、平台界面或他人品牌元素');
  });

  it('仅上传参考图但没有说明时，只补充明确信息，不泛化为整区替换', () => {
    const prompt = buildPrompt(
      {},
      2,
      [{ regionId: 'region-a', referenceIndex: 1 }],
    );

    expect(prompt).toContain('仅按对应参考图补充该区域中明确的外观信息，未明确项保持模板原样');
    expect(prompt).not.toContain('仅按对应参考图替换该区域');
  });

  it('旧版接口没有框选坐标时，编辑上限落在指定位置而不是不存在的框选区域', () => {
    const prompt = buildPrompt({ regions: undefined }, 1, []);

    expect(prompt).toContain('指定位置是编辑上限');
    expect(prompt).not.toContain('框选范围是编辑上限');
  });

  it('画幅比例是硬约束，保持模板时不得拉伸商品', () => {
    const prompt = buildPrompt({ ratio: '3:4' });

    expect(prompt).toContain('目标画幅比例 3:4 是硬约束');
    expect(prompt).toContain('不拉伸商品和背景');
  });
});

describe('sku_image 参数解析', () => {
  it('区域坐标收敛到画面内，并丢弃无效区域', () => {
    expect(
      parseSkuRegions(
        JSON.stringify([
          { x: -0.2, y: 0.8, width: 0.5, height: 0.5 },
          { x: 0.1, y: 0.1, width: 0, height: 0.2 },
        ]),
      ),
    ).toEqual([{ x: 0, y: 0.8, width: 0.3, height: 0.2 }]);
  });

  it('默认色为 original 时解析为空，自定义色读取 customColor', () => {
    expect(resolveSkuColor({ skuColor: 'original' })).toBe('');
    expect(resolveSkuColor({ skuColor: 'custom', customColor: ' #AABBCC ' })).toBe('#AABBCC');
  });
});
