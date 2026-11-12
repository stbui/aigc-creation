import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceButton } from '../ChoiceButton';

/**
 * `ChoiceButton` 用 shadcn `Toggle` 承载按下语义：选中态必须落成
 * `aria-pressed=true` + `data-state=on`（样式与读屏都按这两个属性走），
 * 点击走 `onPressedChange` 而不是自己管 state。
 */
describe('ChoiceButton', () => {
  it('未选中时 aria-pressed=false、data-state=off', () => {
    render(
      <ChoiceButton pressed={false} disabled={false} onClick={vi.fn()}>
        常规
      </ChoiceButton>,
    );

    const button = screen.getByRole('button', { name: '常规' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('data-state', 'off');
  });

  it('选中时 aria-pressed=true、data-state=on', () => {
    render(
      <ChoiceButton pressed disabled={false} onClick={vi.fn()}>
        加粗
      </ChoiceButton>,
    );

    const button = screen.getByRole('button', { name: '加粗' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-state', 'on');
  });

  it('点击回调一次，禁用时不触发', async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ChoiceButton pressed={false} disabled={false} onClick={onClick}>
        常规
      </ChoiceButton>,
    );

    await userEvent.click(screen.getByRole('button', { name: '常规' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <ChoiceButton pressed={false} disabled onClick={onClick}>
        常规
      </ChoiceButton>,
    );
    await userEvent.click(screen.getByRole('button', { name: '常规' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
