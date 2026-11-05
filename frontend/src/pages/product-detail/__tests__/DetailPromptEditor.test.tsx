import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DetailPromptEditor } from '../DetailPromptEditor';

describe('DetailPromptEditor', () => {
  it('只为已选模块渲染提示词输入框，并按固定模块顺序排列', () => {
    render(
      <DetailPromptEditor
        selected={['selling_points', 'hero']}
        prompts={{ hero: '首屏提示词', selling_points: '卖点提示词' }}
        onChange={vi.fn()}
      />,
    );

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAccessibleName('首屏主视觉提示词');
    expect(inputs[0]).toHaveValue('首屏提示词');
    expect(inputs[1]).toHaveAccessibleName('核心卖点图提示词');
    expect(inputs[1]).toHaveValue('卖点提示词');
    expect(screen.queryByRole('textbox', { name: '多角度图提示词' })).not.toBeInTheDocument();
    expect(screen.getByText('已配置 2/2')).toBeVisible();
  });

  it('编辑某个模块时只回传该模块的 key 与提示词', () => {
    const onChange = vi.fn();
    render(
      <DetailPromptEditor
        selected={['hero', 'usage_scene']}
        prompts={{ hero: '首屏提示词', usage_scene: '场景提示词' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '使用场景图提示词' }), {
      target: { value: '改成户外露营场景' },
    });
    expect(onChange).toHaveBeenCalledWith('usage_scene', '改成户外露营场景');
  });
});
