import { describe, expect, it } from 'vitest';

import {
  LocalRedraw,
  normalizeLocalRedrawBounds,
  parseLocalRedrawAnnotations,
} from './local_redraw';

describe('local_redraw 标注坐标', () => {
  const bounds = {
    x: 20,
    y: 30,
    width: 100,
    height: 50,
    sourceWidth: 240,
    sourceHeight: 160,
  };

  it('严格解析合法的原图像素包围盒', () => {
    expect(normalizeLocalRedrawBounds(bounds)).toEqual(bounds);
  });

  it.each([
    ['缺少字段', { x: 20, y: 30, width: 100, height: 50 }],
    ['字符串数字', { ...bounds, x: '20' }],
    ['非有限数', { ...bounds, height: null }],
    ['负数', { ...bounds, y: -1 }],
    ['零宽', { ...bounds, width: 0 }],
    ['越界', { ...bounds, x: 200, width: 100 }],
  ])('%s时返回 null', (_name, raw) => {
    expect(normalizeLocalRedrawBounds(raw)).toBeNull();
  });

  it('只有 JSON 字符串能解析出标注；直接对象或数组忽略', () => {
    expect(parseLocalRedrawAnnotations({ instruction: '改成金属材质' })).toEqual([]);
    expect(parseLocalRedrawAnnotations([{ instruction: '改成金属材质' }])).toEqual([]);
  });

  it('提示词包含逐区描述与像素坐标', () => {
    const prompt = LocalRedraw.buildPrompt(
      {
        maskAssetId: 'asset-mask',
        annotations: JSON.stringify([
          {
            annotationId: '1',
            label: '标注1',
            instruction: '把这里改成哑光材质',
            bounds,
          },
          {
            annotationId: '2',
            label: '标注2',
            instruction: '把这里改成磨砂玻璃',
            bounds: { ...bounds, x: 120, y: 80, width: 80, height: 60 },
          },
        ]),
      },
      1,
    );

    expect(prompt).toContain(
      '标注1[区域 x=20, y=30, 宽=100, 高=50, 原图=240×160]：把这里改成哑光材质',
    );
    expect(prompt).toContain(
      '标注2[区域 x=120, y=80, 宽=80, 高=60, 原图=240×160]：把这里改成磨砂玻璃',
    );
    expect(prompt).toContain('只重绘遮罩圈定的区域');
  });
});
