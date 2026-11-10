import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStableIdempotencyKey } from '../useStableIdempotencyKey';

const keys = vi.hoisted(() => ({ next: 0 }));

vi.mock('../api', () => ({
  newIdempotencyKey: () => `key-${++keys.next}`,
}));

describe('useStableIdempotencyKey', () => {
  beforeEach(() => {
    keys.next = 0;
  });

  it('同一打开期间内容不变时复用，内容变化后换新键', () => {
    const { result, rerender } = renderHook(
      ({ active, fingerprint }) => useStableIdempotencyKey(active, fingerprint),
      { initialProps: { active: true, fingerprint: '{"delta":10}' } },
    );

    expect(result.current).toBe('key-1');
    rerender({ active: true, fingerprint: '{"delta":10}' });
    expect(result.current).toBe('key-1');

    rerender({ active: true, fingerprint: '{"delta":20}' });
    expect(result.current).toBe('key-2');
  });

  it('关闭后重新打开会生成新键', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useStableIdempotencyKey(active, '{"delta":10}'),
      { initialProps: { active: true } },
    );

    expect(result.current).toBe('key-1');
    act(() => rerender({ active: false }));
    expect(result.current).toBe('');
    act(() => rerender({ active: true }));
    expect(result.current).toBe('key-2');
  });
});
