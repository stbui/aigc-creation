import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 积分文案只负责把后端下发的运行时价格变成人话。
 *
 * 关键契约：清单没到时返回 null（调用方不显示价格），而不是显示「免费」——
 * 0 与「还没加载」必须区分，否则用户会以为免费、提交后才发现扣费。
 */

const { capsMock } = vi.hoisted(() => ({ capsMock: vi.fn() }));

vi.mock('../useCapabilities', () => ({ useCapabilities: capsMock }));

import { useCreditCost, useCreditLabel } from '../useCreditLabel';

function capsWith(items: Array<{ id: string; creditCost?: number }>) {
  return { data: { groups: [], items, workbenchIds: [] }, loading: false, error: null };
}

beforeEach(() => {
  capsMock.mockReset();
});

describe('useCreditLabel', () => {
  it('清单未加载时返回 null，不冒充免费', () => {
    capsMock.mockReturnValue({ data: null, loading: true, error: null });

    const { result } = renderHook(() => useCreditLabel('creative_image'));
    expect(result.current).toBeNull();
  });

  it('能力不存在时返回 null', () => {
    capsMock.mockReturnValue(capsWith([{ id: 'matting', creditCost: 3 }]));

    const { result } = renderHook(() => useCreditLabel('creative_image'));
    expect(result.current).toBeNull();
  });

  it('0 积分显示「免费」', () => {
    capsMock.mockReturnValue(capsWith([{ id: 'creative_image', creditCost: 0 }]));

    const { result } = renderHook(() => useCreditLabel('creative_image'));
    expect(result.current).toBe('免费');
  });

  it('正数显示本次消耗，数字来自后端而非写死', () => {
    capsMock.mockReturnValue(capsWith([{ id: 'creative_image', creditCost: 10 }]));

    const { result } = renderHook(() => useCreditLabel('creative_image'));
    expect(result.current).toBe('本次消耗 10 积分');
  });

  it('creditCost 缺省按 0 处理', () => {
    capsMock.mockReturnValue(capsWith([{ id: 'creative_image' }]));

    const { result } = renderHook(() => useCreditLabel('creative_image'));
    expect(result.current).toBe('免费');
  });
});

describe('useCreditCost', () => {
  it('返回数字价用于提交前提示', () => {
    capsMock.mockReturnValue(capsWith([{ id: 'creative_image', creditCost: 10 }]));

    const { result } = renderHook(() => useCreditCost('creative_image'));
    expect(result.current).toBe(10);
  });

  it('0 与「未加载」不混淆', () => {
    capsMock.mockReturnValue(capsWith([{ id: 'creative_image', creditCost: 0 }]));
    const free = renderHook(() => useCreditCost('creative_image'));
    expect(free.result.current).toBe(0);

    capsMock.mockReturnValue({ data: null, loading: true, error: null });
    const loading = renderHook(() => useCreditCost('creative_image'));
    expect(loading.result.current).toBeNull();
  });
});
