import { describe, expect, it } from 'vitest';

import {
  MIN_REGION_SIZE,
  eraseMaskRegion,
  fillMaskBackground,
  moveRectWithin,
  pointInsideRect,
  resizeRectWithin,
  sourcePoint,
} from '../geometry';

/**
 * 遮罩画布共享内核。
 *
 * 局部重绘与去水印都依赖这份坐标换算与遮罩协议：数字差一个像素，
 * 用户框的位置和真正送去模型的位置就会错开。这里锁住夹取边界、
 * 最小边长与描边 / 挖洞的合成方式。
 */

const FRAME = { left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250 };

describe('sourcePoint', () => {
  it('按画框缩放换算到原图像素', () => {
    expect(sourcePoint(300, 150, FRAME, 800, 400)).toEqual({ x: 400, y: 200 });
  });

  it('画框外拖拽夹在源图边界内', () => {
    expect(sourcePoint(0, 0, FRAME, 800, 400)).toEqual({ x: 0, y: 0 });
    expect(sourcePoint(999, 999, FRAME, 800, 400)).toEqual({ x: 800, y: 400 });
  });

  it('画框或原图尺寸无效时返回 null', () => {
    expect(sourcePoint(300, 150, null, 800, 400)).toBeNull();
    expect(sourcePoint(300, 150, { ...FRAME, width: 0 }, 800, 400)).toBeNull();
    expect(sourcePoint(300, 150, FRAME, 0, 400)).toBeNull();
  });
});

describe('pointInsideRect', () => {
  it('只认画框内的按下点', () => {
    expect(pointInsideRect(FRAME, 300, 150)).toBe(true);
    expect(pointInsideRect(FRAME, 100, 50)).toBe(true);
    expect(pointInsideRect(FRAME, 99, 150)).toBe(false);
    expect(pointInsideRect(FRAME, 501, 150)).toBe(false);
  });
});

describe('moveRectWithin', () => {
  const snapshot = { x: 10, y: 20, width: 100, height: 50 };

  it('平移保持尺寸并跟随位移', () => {
    expect(moveRectWithin(snapshot, 20, 10, 800, 400)).toEqual({
      x: 30,
      y: 30,
      width: 100,
      height: 50,
    });
  });

  it('四边都夹在源图范围内', () => {
    expect(moveRectWithin(snapshot, -1000, -1000, 800, 400)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(moveRectWithin(snapshot, 1000, 1000, 800, 400)).toEqual({
      x: 700,
      y: 350,
      width: 100,
      height: 50,
    });
  });

  it('矩形比源图更大时停在原点，不产生负坐标', () => {
    expect(moveRectWithin({ x: 10, y: 20, width: 900, height: 500 }, 50, 50, 800, 400)).toMatchObject({
      x: 0,
      y: 0,
    });
  });
});

describe('resizeRectWithin', () => {
  const snapshot = { x: 100, y: 100, width: 200, height: 100 };

  it('单边缩放只移动被按住的边', () => {
    expect(resizeRectWithin(snapshot, 'e', 50, 0, 800, 400)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    });
    expect(resizeRectWithin(snapshot, 'w', 50, 0, 800, 400)).toEqual({
      x: 150,
      y: 100,
      width: 150,
      height: 100,
    });
    expect(resizeRectWithin(snapshot, 'n', 0, 30, 800, 400)).toEqual({
      x: 100,
      y: 130,
      width: 200,
      height: 70,
    });
    expect(resizeRectWithin(snapshot, 's', 0, 30, 800, 400)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 130,
    });
  });

  it('四角缩放同时移动两条边', () => {
    expect(resizeRectWithin(snapshot, 'sw', 50, 20, 800, 400)).toEqual({
      x: 150,
      y: 100,
      width: 150,
      height: 120,
    });
    expect(resizeRectWithin(snapshot, 'ne', 20, 30, 800, 400)).toEqual({
      x: 100,
      y: 130,
      width: 220,
      height: 70,
    });
  });

  it('不允许缩到最小边长以下', () => {
    expect(resizeRectWithin(snapshot, 'w', 1000, 0, 800, 400).width).toBe(MIN_REGION_SIZE);
    expect(resizeRectWithin(snapshot, 'n', 0, 1000, 800, 400).height).toBe(MIN_REGION_SIZE);
  });

  it('放大不超过源图边界', () => {
    expect(resizeRectWithin(snapshot, 'e', 10000, 0, 800, 400).width).toBe(700);
    expect(resizeRectWithin(snapshot, 's', 0, 10000, 800, 400).height).toBe(300);
    expect(resizeRectWithin({ ...snapshot, x: 10 }, 'w', -1000, 0, 800, 400).x).toBe(0);
  });

  it('没有方向时保持原样', () => {
    expect(resizeRectWithin(snapshot, undefined, 50, 50, 800, 400)).toEqual(snapshot);
  });
});

/** 只实现遮罩绘制用到的上下文方法，便于断言调用顺序与合成参数。 */
function createContextSpy() {
  const calls: string[] = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    fillRect: (...args: number[]) => calls.push(`fillRect:${args.join(',')}`),
    beginPath: () => calls.push('beginPath'),
    ellipse: (...args: number[]) =>
      calls.push(`ellipse:${args.map((value) => value.toFixed(2)).join(',')}`),
    fill: () => calls.push('fill'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx };
}

describe('遮罩生成', () => {
  it('底色为不透明白色，后续挖洞才有可擦除的 alpha', () => {
    const { ctx, calls, raw } = createContextSpy();
    fillMaskBackground(ctx, 640, 480);
    expect(calls).toEqual(['fillRect:0,0,640,480']);
    expect(raw.globalCompositeOperation).toBe('source-over');
    expect(raw.globalAlpha).toBe(1);
    expect(raw.fillStyle).toBe('white');
  });

  it('矩形区域用 destination-out 挖成透明', () => {
    const { ctx, calls, raw } = createContextSpy();
    eraseMaskRegion(ctx, 'rect', { x: 10, y: 20, width: 30, height: 40 });
    expect(calls).toEqual(['save', 'fillRect:10,20,30,40', 'restore']);
    expect(raw.globalCompositeOperation).toBe('destination-out');
    expect(raw.fillStyle).toBe('black');
  });

  it('椭圆区域按中心与半径挖空', () => {
    const { ctx, calls } = createContextSpy();
    eraseMaskRegion(ctx, 'ellipse', { x: 10, y: 20, width: 30, height: 40 });
    expect(calls).toEqual([
      'save',
      'beginPath',
      'ellipse:25.00,40.00,15.00,20.00,0.00,0.00,6.28',
      'fill',
      'restore',
    ]);
  });
});
