import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AdminCapabilityControl } from '../../../../types/api';
import { CapabilityOverview } from '../CapabilityOverview';

const capability: AdminCapabilityControl = {
  capabilityId: 'expand',
  name: '智能扩图',
  group: 'ai_retouch',
  modality: 'image',
  mode: 'real',
  enabled: true,
  reason: null,
  updatedBy: null,
  updatedAt: null,
  runtime: {
    enabled: true,
    remoteAvailable: true,
    effective: 'remote',
    reason: '线路可用',
  },
};

describe('CapabilityOverview 读取状态', () => {
  it('绑定与售价加载中显示未知态，不展示成 0 或默认价', () => {
    render(
      <CapabilityOverview
        capability={capability}
        bindings={null}
        bindingsLoading
        pricing={null}
        pricingLoading
        bindingsReadable
        pricingReadable
        capabilityWritable={false}
        savingEnabled={false}
        onToggle={() => undefined}
      />,
    );

    expect(screen.getAllByText('读取中…').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('默认价')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('无绑定读取权限时显示权限态而不是 0', () => {
    render(
      <CapabilityOverview
        capability={capability}
        bindings={null}
        pricing={null}
        bindingsReadable={false}
        pricingReadable={false}
        capabilityWritable={false}
        savingEnabled={false}
        onToggle={() => undefined}
      />,
    );

    expect(screen.getAllByText('无绑定读取权限').length).toBeGreaterThan(0);
    expect(screen.getByText('无售价读取权限')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
});
