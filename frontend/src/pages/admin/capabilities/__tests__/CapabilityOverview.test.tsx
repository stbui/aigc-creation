import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AdminCapabilityControl } from '../../../../types/api';
import type { AdminCapabilityModelListView, CapabilityPricingView } from '../../../../types/model';
import { CapabilityOverview } from '../CapabilityOverview';

const capability: AdminCapabilityControl = {
  capabilityId: 'expand',
  name: '智能扩图',
  summary: '按比例扩展画面并补全边缘。',
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

const pricing: CapabilityPricingView = {
  capabilityId: 'expand',
  billingMode: 'fixed_request',
  unitPriceMicrocredits: 2_000_000,
  inputTokenPriceMicrocredits: 0,
  outputTokenPriceMicrocredits: 0,
  cachedTokenPriceMicrocredits: 0,
  configured: true,
  source: 'capability_pricing',
  defaultUnitPriceMicrocredits: 1_000_000,
  updatedBy: 'admin@example.com',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function binding(overrides: Partial<AdminCapabilityModelListView['bindings'][number]> = {}) {
  return {
    id: 'bind-1',
    capabilityId: 'expand',
    channelModelId: 'cm-1',
    modelKey: 'gpt-image-2.5-flare',
    modelGroupKey: 'gpt-image',
    displayName: 'gpt-image-2.5-flare',
    channelId: 'ch-1',
    channelName: 'inkx · 生图',
    enabled: true,
    priority: 0,
    weight: 100,
    channelEnabled: true,
    modelEnabled: true,
    priceConfigured: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function bindingView(overrides: Partial<AdminCapabilityModelListView> = {}): AdminCapabilityModelListView {
  return {
    capabilityId: 'expand',
    bindings: [binding(), binding({ id: 'bind-2', channelModelId: 'cm-2', modelKey: 'gpt-image-2.5-sunburst' })],
    invalidBindings: [],
    invalidCount: 0,
    candidates: [],
    ...overrides,
  };
}

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

  it('健康状态用业务口径给出下一步，而不是堆砌技术字段', () => {
    render(
      <CapabilityOverview
        capability={capability}
        bindings={bindingView()}
        pricing={pricing}
        bindingsReadable
        pricingReadable
        capabilityWritable
        savingEnabled={false}
        onToggle={() => undefined}
      />,
    );

    expect(screen.getByText('可承接线路')).toBeTruthy();
    expect(screen.getByText('绑定商品')).toBeTruthy();
    expect(screen.getByText('2 积分 / 次')).toBeTruthy();
    expect(screen.getByText('运行正常，C 端可正常提交')).toBeTruthy();
    expect(screen.getByText('下线能力')).toBeTruthy();
  });

  it('存在停用绑定时指出具体商品与原因', () => {
    render(
      <CapabilityOverview
        capability={capability}
        bindings={bindingView({
          bindings: [binding(), binding({ id: 'bind-2', channelModelId: 'cm-2', enabled: false })],
        })}
        pricing={pricing}
        bindingsReadable
        pricingReadable
        capabilityWritable={false}
        savingEnabled={false}
        onToggle={() => undefined}
      />,
    );

    expect(screen.getByText(/gpt-image-2\.5-flare：未参与选路/)).toBeTruthy();
    expect(screen.getByText(/1 条因供应商、商品或绑定停用未参与选路/)).toBeTruthy();
  });

  it('下线状态展示下线原因，并提示恢复后的验证动作', () => {
    render(
      <CapabilityOverview
        capability={{
          ...capability,
          enabled: false,
          reason: '供应商通道维护中',
          runtime: {
            enabled: false,
            remoteAvailable: true,
            effective: 'disabled',
            reason: '供应商通道维护中',
          },
        }}
        bindings={bindingView()}
        pricing={pricing}
        bindingsReadable
        pricingReadable
        capabilityWritable
        savingEnabled={false}
        onToggle={() => undefined}
      />,
    );

    expect(screen.getByText('能力已下线，C 端不可提交')).toBeTruthy();
    expect(screen.getAllByText(/供应商通道维护中/).length).toBeGreaterThan(0);
    expect(screen.getByText('上线能力')).toBeTruthy();
  });
});
