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
    reason: '商品可用',
  },
};

describe('ImpactPanel 绑定读取状态', () => {
  it('正常状态只说明运行结果，不展示状态标签或统计卡', () => {
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

    expect(screen.getByText('当前状态：运行正常，用户可以提交新任务。')).toBeTruthy();
    expect(screen.queryByText('可提交')).toBeNull();
    expect(screen.queryByText('用户能否提交')).toBeNull();
  });

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

    expect(screen.getByText('无法查看商品配置')).toBeTruthy();
    expect(screen.queryByText(/还没有配置商品/)).toBeNull();
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

    expect(screen.getByText('正在读取商品配置…')).toBeTruthy();
    expect(screen.getAllByText('读取中…').length).toBeGreaterThan(0);
    expect(screen.queryByText(/还没有配置商品/)).toBeNull();
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

    expect(screen.getAllByText('商品配置读取失败。请稍后刷新页面重试。').length).toBeGreaterThan(0);
    expect(screen.queryByText(/网络错误/)).toBeNull();
    expect(screen.queryByText(/还没有配置商品/)).toBeNull();
  });

  it('没有绑定时说明后果并给出配置入口', () => {
    render(
      <MemoryRouter>
        <ImpactPanel
          capability={capability}
          bindings={{
            capabilityId: 'expand',
            bindings: [],
            invalidBindings: [],
            invalidCount: 0,
            candidates: [],
          }}
          pricing={null}
          bindingsReadable
          pricingReadable={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('还没有配置商品，用户暂时不能提交该能力。请到「商品绑定」页添加。'),
    ).toBeTruthy();
  });
});
