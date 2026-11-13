import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AdminCapabilityControl } from '../../../../types/api';
import { ImpactPanel } from '../ImpactPanel';

const capability: AdminCapabilityControl = {
  capabilityId: 'expand',
  name: '智能扩图',
  summary: '自然补全画面边缘与展示空间。',
  group: 'ai_retouch',
  groupName: 'AI修图',
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

describe('ImpactPanel 绑定读取状态', () => {
  it('无读取权限时优先显示权限提示，不误报没有有效绑定', () => {
    render(
      <MemoryRouter>
        <ImpactPanel
          capability={capability}
          bindings={null}
          pricing={null}
          bindingsReadable={false}
          pricingReadable={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('无绑定读取权限')).toBeTruthy();
    expect(screen.queryByText(/没有有效绑定/)).toBeNull();
  });

  it('加载中显示读取中，不把未知数量展示成 0', () => {
    render(
      <MemoryRouter>
        <ImpactPanel
          capability={capability}
          bindings={null}
          bindingsLoading
          pricing={null}
          bindingsReadable
          pricingReadable={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('正在读取绑定配置…')).toBeTruthy();
    expect(screen.getAllByText('读取中…').length).toBeGreaterThan(0);
    expect(screen.queryByText(/没有有效绑定/)).toBeNull();
  });

  it('读取失败时说明失败，不伪装成空绑定', () => {
    render(
      <MemoryRouter>
        <ImpactPanel
          capability={capability}
          bindings={null}
          bindingsError="网络错误"
          pricing={null}
          bindingsReadable
          pricingReadable={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('绑定配置读取失败，请稍后重试。')).toBeTruthy();
    expect(screen.queryByText(/没有有效绑定/)).toBeNull();
  });
});
