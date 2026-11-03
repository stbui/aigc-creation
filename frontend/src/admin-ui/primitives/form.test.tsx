import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormField, TextField } from './form';

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
