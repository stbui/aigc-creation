import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorSwatchGrid, type ColorOption } from '../ToolWidgets';

const OPTIONS: ColorOption[] = [
  { value: 'transparent', label: '透明底', css: 'transparent' },
  { value: 'white', label: '白色', css: '#FFFFFF' },
  { value: 'blue', label: '蓝色', css: '#3988E9' },
];

/**
 * 参考站色板的三个可见契约：
 *   1. 白色与透明底各有独立背景，不能白底吞掉白色；
 *   2. 只有当前色块渲染勾选图标；
 *   3. 自定义色未选时显示彩虹图，选中后显示当前色与白底紫勾。
 */
describe('ColorSwatchGrid', () => {
  it('白色与透明底使用独立样式，彩色块直接落在按钮背景上', () => {
    const { container } = render(
      <ColorSwatchGrid options={OPTIONS} value="transparent" onChange={() => {}} ariaLabel="背景颜色" />,
    );

    expect(screen.getByRole('button', { name: '透明底' })).toHaveClass('checker', 'active');
    expect(screen.getByRole('button', { name: '白色' })).toHaveClass('white');
    expect((screen.getByRole('button', { name: '蓝色' }) as HTMLElement).style.background).toBe(
      'rgb(57, 136, 233)',
    );

    const checks = container.querySelectorAll('.background-color-option > svg');
    expect(checks).toHaveLength(1);
    expect(screen.getByRole('button', { name: '透明底' })).toContainElement(checks[0] as SVGElement);
  });

  it('自定义色未选中时显示彩虹素材，不渲染勾', () => {
    const onCustom = vi.fn();
    const { container } = render(
      <ColorSwatchGrid
        options={OPTIONS}
        value="white"
        onChange={() => {}}
        onCustom={onCustom}
        customActive={false}
        customColor="#22C55E"
        ariaLabel="背景颜色"
      />,
    );

    const trigger = screen.getByRole('button', { name: '自定义颜色' });
    expect(trigger).not.toHaveClass('custom-selected');
    expect(trigger).not.toHaveAttribute('style');
    expect(trigger.querySelector('img')).toHaveAttribute('src', '/static/color.svg');
    expect(container.querySelector('.custom-check')).toBeNull();
  });

  it('自定义色选中后显示当前颜色与白底紫勾', async () => {
    const onCustom = vi.fn();
    const { container } = render(
      <ColorSwatchGrid
        options={OPTIONS}
        value="custom"
        onChange={() => {}}
        onCustom={onCustom}
        customActive
        customColor="#22C55E"
        ariaLabel="背景颜色"
      />,
    );

    const trigger = screen.getByRole('button', { name: '自定义颜色' });
    expect(trigger).toHaveClass('active', 'custom-selected');
    expect(trigger.style.background).toBe('rgb(34, 197, 94)');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger.querySelector('img')).toBeInTheDocument();
    expect(container.querySelector('.custom-check')).toBeInTheDocument();

    await userEvent.click(trigger);
    expect(onCustom).toHaveBeenCalledOnce();
  });
});
