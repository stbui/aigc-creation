import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Descriptions } from '../radar/feedback';

/**
 * 键值描述的多列落成基类（T-040，docs/admin-ui-design.md §5.3）。
 *
 * 原实现是 `grid-cols-1` + `sm:grid-cols-2|3`。后台最低支持宽度 1280，
 * `sm:`（≥640）在支持区间内恒生效，等价基类，所以直接写列数。
 * 1280 及以上的渲染不变；变化只发生在 <640 的非支持区间。
 */
describe('Descriptions 多列', () => {
  const items = [
    { label: '甲', value: '1' },
    { label: '乙', value: '2' },
    { label: '丙', value: '3' },
  ];

  it.each([
    [2, 'grid-cols-2'],
    [3, 'grid-cols-3'],
  ] as const)('columns=%i 直接落成 %s，不带断点前缀', (columns, expected) => {
    render(<Descriptions columns={columns} items={items} />);
    const dl = screen.getByTestId('admin-desc');
    expect(dl.className).toContain(expected);
    expect(dl.className).not.toContain(`sm:${expected}`);
    expect(dl.className).not.toMatch(/\b(sm|md|lg|xl|2xl):/);
  });

  it('单列时不加任何列数类', () => {
    render(<Descriptions items={items} />);
    const dl = screen.getByTestId('admin-desc');
    expect(dl.className).toContain('grid-cols-1');
    expect(dl.className).not.toContain('grid-cols-2');
    expect(dl.className).not.toContain('grid-cols-3');
  });
});