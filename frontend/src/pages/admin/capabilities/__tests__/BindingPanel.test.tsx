import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '~/admin-ui/providers/ConfirmProvider';
import { ToastProvider } from '~/admin-ui/providers/ToastProvider';
import { BindingPanel } from '../BindingPanel';
import type { AdminCapabilityModelListView } from '../../../../types/model';

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

describe('BindingPanel 失效绑定展示', () => {
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
