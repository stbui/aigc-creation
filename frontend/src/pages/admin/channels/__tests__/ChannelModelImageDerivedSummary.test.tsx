import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelModelImageDerivedSummary } from '../ChannelModelImageDerivedSummary';
import { createDefaultImageCapabilityConfig } from '../imageCapability';

describe('ChannelModelImageDerivedSummary', () => {
  it('展示由协议参数派生的尺寸、质量和输出数量', () => {
    const image = createDefaultImageCapabilityConfig([
      {
        name: 'size',
        label: '尺寸',
        type: 'string',
        encoding: 'pixels',
        values: ['1024x1024'],
        default: '1024x1024',
      },
      { name: 'quality', label: '质量', type: 'string', values: ['high'], default: 'high' },
      { name: 'count', label: '数量', type: 'integer', max: 4 },
    ]);

    render(<ChannelModelImageDerivedSummary image={image} />);

    expect(screen.getByText('像素尺寸')).toBeVisible();
    expect(screen.getByText('high')).toBeVisible();
    expect(screen.getByText('4 张')).toBeVisible();
  });
});
