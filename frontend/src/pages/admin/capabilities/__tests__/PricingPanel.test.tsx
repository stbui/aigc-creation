import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '~/admin-ui/providers/ConfirmProvider';
import { ToastProvider } from '~/admin-ui/providers/ToastProvider';
import type { CapabilityPricingView } from '../../../../types/model';
import { PricingPanel } from '../PricingPanel';

function renderPanel({
  data = null,
  loading = false,
  error = null,
}: {
  data?: CapabilityPricingView | null;
  loading?: boolean;
  error?: string | null;
}) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <PricingPanel
          capabilityId="expand"
          capabilityName="智能扩图"
          data={data}
          loading={loading}
          error={error}
          writable
          onRetry={vi.fn()}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

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

describe('PricingPanel 读取状态', () => {
  it('首屏加载时显示占位态，不把未知售价渲染成 0', () => {
    renderPanel({ loading: true });

    expect(screen.getByText('正在读取能力售价…')).toBeTruthy();
    expect(screen.queryByLabelText('单次价格')).toBeNull();
    expect(screen.queryByText('能力默认价')).toBeNull();
    expect(screen.queryByText('0 积分')).toBeNull();
  });

  it('首屏读取失败时显示可重试错误态，不伪装成上次数据', () => {
    renderPanel({ error: '网络错误' });

    expect(screen.getByText('加载失败')).toBeTruthy();
    expect(screen.getByText('网络错误')).toBeTruthy();
    expect(screen.queryByText('刷新失败，下面是上一次成功获取的数据')).toBeNull();
    expect(screen.queryByLabelText('单次价格')).toBeNull();
  });

  it('刷新失败但已有售价时保留数据并明确提示旧数据', () => {
    renderPanel({ data: pricing, error: '网络错误' });

    expect(screen.getByText('刷新失败，下面是上一次成功获取的数据')).toBeTruthy();
    expect(screen.getByLabelText('单次价格')).toBeTruthy();
    expect(screen.getByDisplayValue('2')).toBeTruthy();
  });
});
