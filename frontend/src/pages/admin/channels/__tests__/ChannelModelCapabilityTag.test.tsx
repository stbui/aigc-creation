import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelModelCapabilityTag } from '../ChannelModelCapabilityTag';

describe('ChannelModelCapabilityTag', () => {
  it('空能力显示待配置，避免渲染空胶囊', () => {
    render(<ChannelModelCapabilityTag capability="" />);

    const tag = screen.getByText('待配置');
    expect(tag.closest('[data-status]')?.getAttribute('data-status')).toBe('capability-unset');
  });

  it('已知能力显示中文名称', () => {
    render(<ChannelModelCapabilityTag capability="image" />);

    const tag = screen.getByText('图像');
    expect(tag.closest('[data-status]')?.getAttribute('data-status')).toBe('capability');
  });

  it('未知能力保留原值并标记为异常', () => {
    render(<ChannelModelCapabilityTag capability="embedding" />);

    const tag = screen.getByText('embedding');
    expect(tag.closest('[data-status]')?.getAttribute('data-status')).toBe('capability-unknown');
  });
});
