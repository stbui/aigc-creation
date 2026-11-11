import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MaskSession } from '../session';
import type { MaskState, Point } from '../types';

/**
 * 会话状态机：提交 / 丢弃 / 上限 / 撤销 / 删除 / 拖动缩放 / 通知通道。
 *
 * jsdom 没有 2D 上下文，这里把 `getContext` 固定为 null —— 遮罩栅格化不在
 * 本文件的覆盖范围（几何与绘制契约由 geometry 用例锁住），会话的标记与
 * 状态变化不依赖真实像素。
 */

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => null as unknown as CanvasRenderingContext2D,
  );
});

const point = (x: number, y: number): Point => ({ x, y });

function createSession(options = {}) {
  const session = new MaskSession(options);
  session.setSourceSize(400, 300);
  return session;
}

function drawRect(session: MaskSession, from: Point, to: Point) {
  session.beginGesture('rect', from);
  session.extendGesture(to);
  session.endGesture();
}

describe('MaskSession 手势提交', () => {
  it('涂抹达到可见长度后提交为区域，并可按原图坐标给出包围盒', () => {
    const session = createSession();
    session.beginGesture('brush', point(10, 10), 8);
    session.extendGesture(point(80, 10));
    session.endGesture();

    expect(session.getRegionCount()).toBe(1);
    expect(session.getRegionBounds()).toEqual([
      { id: 1, x: 6, y: 6, width: 78, height: 8, sourceWidth: 400, sourceHeight: 300 },
    ]);
    expect(session.getState().canUndo).toBe(true);
  });

  it('单点涂抹与过小的形状在抬起时被丢弃', () => {
    const session = createSession();
    session.beginGesture('brush', point(10, 10), 8);
    session.endGesture();
    expect(session.getRegionCount()).toBe(0);

    session.beginGesture('rect', point(10, 10));
    session.extendGesture(point(12, 12));
    session.endGesture();
    expect(session.getRegionCount()).toBe(0);
    expect(session.getSelectedId()).toBeNull();
  });

  it('形状提交后立即选中，包围盒与拖拽范围一致', () => {
    const session = createSession();
    drawRect(session, point(10, 20), point(110, 120));

    expect(session.getSelectedId()).toBe(1);
    expect(session.getRegionBounds()).toEqual([
      { id: 1, x: 10, y: 20, width: 100, height: 100, sourceWidth: 400, sourceHeight: 300 },
    ]);
  });

  it('取消手势会丢弃草稿，不留下未提交的标记', () => {
    const session = createSession();
    session.beginGesture('brush', point(10, 10), 8);
    session.extendGesture(point(100, 10));
    session.cancelGesture();

    expect(session.getRegionCount()).toBe(0);
    expect(session.getOverlayModel().marks).toHaveLength(0);
  });

  it('橡皮不产生新区域，但完全擦除后原涂抹也不再计入', () => {
    const session = createSession();
    session.beginGesture('brush', point(10, 10), 8);
    session.extendGesture(point(80, 10));
    session.endGesture();
    expect(session.getRegionCount()).toBe(1);

    session.beginGesture('eraser', point(10, 10), 40);
    session.extendGesture(point(80, 10));
    session.endGesture();
    expect(session.getRegionCount()).toBe(0);
    expect(session.getState().canUndo).toBe(true);
  });
});

describe('MaskSession 区域上限', () => {
  it('超出上限的草稿不提交，并回调提示', () => {
    const onRegionLimit = vi.fn();
    const session = createSession({ maxRegions: 1, onRegionLimit });

    drawRect(session, point(0, 0), point(50, 50));
    drawRect(session, point(100, 100), point(150, 150));

    expect(session.getRegionCount()).toBe(1);
    expect(onRegionLimit).toHaveBeenCalledTimes(1);
  });
});

describe('MaskSession 撤销 / 恢复 / 删除', () => {
  it('撤销与恢复保持标记身份，删除按稳定 id 生效', () => {
    const session = createSession();
    drawRect(session, point(0, 0), point(50, 50));
    drawRect(session, point(100, 100), point(150, 150));

    session.undo();
    expect(session.getRegionCount()).toBe(1);
    expect(session.getState().canRedo).toBe(true);

    session.redoStep();
    expect(session.getRegionCount()).toBe(2);

    session.removeRegion(1);
    expect(session.getRegionBounds().map((region) => region.id)).toEqual([2]);

    session.clear();
    expect(session.getRegionCount()).toBe(0);
    expect(session.getState().canUndo).toBe(false);
    expect(session.getState().canRedo).toBe(false);
  });
});

describe('MaskSession 拖动与缩放', () => {
  it('整体拖动保持尺寸并夹在源图内', () => {
    const session = createSession();
    drawRect(session, point(10, 10), point(110, 110));

    expect(session.beginDrag(1, 'move', point(20, 20))).toBe(true);
    session.extendDrag(point(50, 40));
    session.endDrag();

    expect(session.getRegionBounds()[0]).toMatchObject({ x: 40, y: 30, width: 100, height: 100 });
  });

  it('四角缩放同时移动宽高，且不越过最小边长', () => {
    const session = createSession();
    drawRect(session, point(10, 10), point(110, 110));

    session.beginDrag(1, 'resize', point(110, 110), 'se');
    session.extendDrag(point(140, 150));
    session.endDrag();
    expect(session.getRegionBounds()[0]).toMatchObject({ width: 130, height: 140 });

    session.beginDrag(1, 'resize', point(140, 150), 'nw');
    session.extendDrag(point(1000, 1000));
    session.endDrag();
    expect(session.getRegionBounds()[0].width).toBe(4);
    expect(session.getRegionBounds()[0].height).toBe(4);
  });

  it('不存在的标记不会进入拖拽', () => {
    const session = createSession();
    expect(session.beginDrag(99, 'move', point(0, 0))).toBe(false);
    expect(session.isDragging()).toBe(false);
  });
});

describe('MaskSession 通知通道', () => {
  it('连续手势只通知叠层，不按帧回传页面状态', async () => {
    const session = createSession();
    const states: MaskState[] = [];
    let overlayCalls = 0;
    session.onStateChange((state) => states.push(state));
    session.subscribe(() => {
      overlayCalls += 1;
    });

    session.beginGesture('brush', point(10, 10), 4);
    session.extendGesture(point(60, 10));
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(overlayCalls).toBeGreaterThanOrEqual(1);
    expect(states).toHaveLength(0);

    session.endGesture();
    expect(states).toHaveLength(1);
    expect(states[0].canUndo).toBe(true);
  });

  it('叠层模型包含草稿，并按可见区域编号、抽稀笔迹点', () => {
    const session = createSession();
    session.beginGesture('brush', point(10, 10), 4);
    session.extendGesture(point(50, 10));

    const model = session.getOverlayModel();
    expect(model.marks).toHaveLength(1);
    expect(model.regionIndex.get(model.marks[0].id)).toBe(1);
    expect(model.dotsById.get(model.marks[0].id)).toHaveLength(2);
  });
  it('清空后不复用旧 id，避免页面把旧描述挂到新区域', () => {
    const session = createSession();
    drawRect(session, point(0, 0), point(50, 50));
    session.clear();
    drawRect(session, point(0, 0), point(50, 50));

    expect(session.getRegionBounds()[0].id).toBe(2);
  });
});

describe('MaskSession 换图', () => {
  it('设置新的原图尺寸会清空标记与撤销栈，并重新从 1 编号', () => {
    const session = createSession();
    drawRect(session, point(0, 0), point(50, 50));

    session.setSourceSize(800, 600);

    expect(session.getSourceSize()).toEqual({ width: 800, height: 600 });
    expect(session.getRegionCount()).toBe(0);
    expect(session.getState().canUndo).toBe(false);
    expect(session.getSelectedId()).toBeNull();

    drawRect(session, point(0, 0), point(50, 50));
    expect(session.getRegionBounds()[0].id).toBe(1);
  });
});
