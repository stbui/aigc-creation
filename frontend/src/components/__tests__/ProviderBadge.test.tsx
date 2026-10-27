import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProviderBadge, providerLabel } from '../ProviderBadge';

/**
 * 产出徽标必须读「这一单实际走了哪条通道」，不能按能力清单的静态 mode 猜。
 * pending / 未知来源不渲染，避免把执行中的任务标成结果。
 */
describe('ProviderBadge', () => {
  it('gateway 显示「真实模型」并使用 remote 配色', () => {
    render(<ProviderBadge provider="gateway" />);

    const badge = screen.getByText('真实模型');
    expect(badge).toHaveClass('provider-badge', 'is-remote');
    expect(badge).toHaveAttribute('title', '本次由云端模型通道生成');
  });

  it('local 显示「历史本地结果」，如实标识旧产出', () => {
    render(<ProviderBadge provider="local" className="extra" />);

    const badge = screen.getByText('历史本地结果');
    expect(badge).toHaveClass('is-local', 'extra');
  });

  it.each([undefined, null, '', 'pending', 'unknown'])('来源为 %s 时不渲染', (provider) => {
    const { container } = render(<ProviderBadge provider={provider} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('providerLabel', () => {
  it('返回与徽标一致的文案', () => {
    expect(providerLabel('gateway')).toBe('真实模型');
    expect(providerLabel('local')).toBe('历史本地结果');
  });

  it('未知来源返回 null', () => {
    expect(providerLabel('pending')).toBeNull();
    expect(providerLabel(null)).toBeNull();
  });
});
