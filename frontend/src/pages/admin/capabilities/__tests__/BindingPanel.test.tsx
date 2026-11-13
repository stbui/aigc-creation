import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '~/admin-ui/providers/ConfirmProvider';
import { ToastProvider } from '~/admin-ui/providers/ToastProvider';
import type { AdminCapabilityModelListView } from '../../../../types/model';
import { BindingPanel, candidateToDraft } from '../BindingPanel';

const data: AdminCapabilityModelListView = {
  capabilityId: 'expand',
  bindings: [],
  invalidBindings: [
    {
      id: 'binding-1',
      capabilityId: 'expand',
      channelModelId: 'cm-deleted',
      displayName: '已删除的生图商品',
      modelKey: 'image-model',
      channelId: 'channel-1',
      channelName: '主供应商',
      modelDeleted: true,
      enabled: true,
      priority: 0,
      weight: 100,
      reason: '商品已删除',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  invalidCount: 1,
  candidates: [],
};

describe('BindingPanel 候选与成本状态', () => {
  it('新加入候选沿用接口返回的真实成本配置状态', () => {
    const draft = candidateToDraft({
      channelModelId: 'cm-new',
      modelKey: 'image-new',
      displayName: '新候选商品',
      icon: '',
      channelId: 'channel-1',
      channelName: '主供应商',
      enabled: true,
      channelEnabled: true,
      priceConfigured: true,
      bound: false,
      compatible: true,
      reason: '',
    });

    expect(draft.priceConfigured).toBe(true);
    expect(draft.modelEnabled).toBe(true);
  });

  it('成本未配置仍显示配置可用，并单独提示毛利不可算', () => {
    const unconfiguredCostData: AdminCapabilityModelListView = {
      ...data,
      invalidBindings: [],
      invalidCount: 0,
      bindings: [
        {
          id: 'binding-2',
          capabilityId: 'expand',
          channelModelId: 'cm-live',
          modelKey: 'image-live',
          modelGroupKey: 'image-live',
          displayName: '可用但无成本档商品',
          channelId: 'channel-1',
          channelName: '主供应商',
          enabled: true,
          priority: 0,
          weight: 100,
          channelEnabled: true,
          modelEnabled: true,
          priceConfigured: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    render(
      <ToastProvider>
        <ConfirmProvider>
          <BindingPanel
            capabilityId="expand"
            data={unconfiguredCostData}
            loading={false}
            error={null}
            writable
            onRetry={vi.fn()}
            onChanged={vi.fn()}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );

    expect(screen.getByText('配置可用')).toBeTruthy();
    expect(screen.getByText('成本未配置，毛利不可算')).toBeTruthy();
    expect(screen.queryByText('商品未定价')).toBeNull();
  });
});

describe('BindingPanel 失效商品展示', () => {
  it('优先展示商品名、模型与供应商，同时保留原绑定 ID 供排查', () => {
    render(
      <ToastProvider>
        <ConfirmProvider>
          <BindingPanel
            capabilityId="expand"
            data={data}
            loading={false}
            error={null}
            writable
            onRetry={vi.fn()}
            onChanged={vi.fn()}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );

    expect(screen.getByText('已删除的生图商品')).toBeTruthy();
    expect(screen.getByText(/模型 image-model · 供应商 主供应商 · 原绑定 cm-deleted/)).toBeTruthy();
    expect(screen.getByTitle('原始绑定 ID：cm-deleted')).toBeTruthy();
    expect(screen.getByText('商品已删除')).toBeTruthy();
  });
});
