import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FormField, SegmentedGroup, TextField } from './form';

describe('Admin FormField', () => {
  it('将 label 关联到布局容器内的真实控件，并注入错误语义', () => {
    render(
      <FormField label="模型名称" required error="请输入模型名称">
        <div className="grid grid-cols-2">
          <TextField value="" onChange={vi.fn()} />
          <button type="button">辅助操作</button>
        </div>
      </FormField>,
    );

    const input = screen.getByLabelText('模型名称');
    const error = screen.getByRole('alert');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('不覆盖控件已有的 id', () => {
    render(
      <FormField label="模型名称" htmlFor="fallback-id">
        <TextField id="existing-id" value="" onChange={vi.fn()} />
      </FormField>,
    );

    expect(screen.getByLabelText('模型名称')).toHaveAttribute('id', 'existing-id');
  });
});

describe('SegmentedGroup', () => {
  it('使用 ToggleGroup 的单选语义并回传选中值', () => {
    const onChange = vi.fn();
    render(
      <SegmentedGroup
        ariaLabel="状态筛选"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: '全部' },
          { value: 'active', label: '启用' },
        ]}
      />,
    );

    expect(screen.getByRole('radiogroup', { name: '状态筛选' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '全部' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '启用' })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('radio', { name: '启用' }));
    expect(onChange).toHaveBeenCalledWith('active');
  });

  it('由 ToggleGroup 处理方向键焦点移动与回车选择', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedGroup
        ariaLabel="状态筛选"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: '全部' },
          { value: 'active', label: '启用' },
        ]}
      />,
    );

    const current = screen.getByRole('radio', { name: '全部' });
    current.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: '启用' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('active');
  });
});
