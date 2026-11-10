import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductStatusStrip } from '../ProductStatusStrip';

const counts = {
  available: 3,
  unpriced: 2,
  unconfigured: 1,
  disabled: 4,
  cooling: 1,
};

describe('ProductStatusStrip', () => {
  it('点状态格回传对应筛选，再点一次取消', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ProductStatusStrip counts={counts} active="all" onChange={onChange} />,
    );

    expect(screen.getByTestId('product-status-strip')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /待定价/ }));
    expect(onChange).toHaveBeenCalledWith('unpriced');

    rerender(<ProductStatusStrip counts={counts} active="unpriced" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /待定价/ }));
    expect(onChange).toHaveBeenLastCalledWith('all');
  });
});
