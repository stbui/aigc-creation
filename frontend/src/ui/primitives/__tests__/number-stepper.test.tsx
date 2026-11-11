import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NumberStepper } from '../number-stepper';

describe('NumberStepper', () => {
  it('步进按钮按步长增减并把结果夹取到区间内', () => {
    const onChange = vi.fn();
    render(<NumberStepper label="张数" value={4} min={0} max={5} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '增加张数' }));
    expect(onChange).toHaveBeenLastCalledWith(5);

    fireEvent.click(screen.getByRole('button', { name: '减少张数' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('到达上下界时对应按钮禁用', () => {
    const { rerender } = render(
      <NumberStepper label="张数" value={0} min={0} max={5} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '减少张数' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '增加张数' })).toBeEnabled();

    rerender(<NumberStepper label="张数" value={5} min={0} max={5} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '减少张数' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '增加张数' })).toBeDisabled();
  });

  it('输入框越界、小数与清空统一取整夹取', () => {
    const onChange = vi.fn();
    render(<NumberStepper label="张数" value={2} min={1} max={5} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '张数' });

    fireEvent.change(input, { target: { value: '9' } });
    expect(onChange).toHaveBeenLastCalledWith(5);

    fireEvent.change(input, { target: { value: '3.6' } });
    expect(onChange).toHaveBeenLastCalledWith(4);

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
