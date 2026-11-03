import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminAlertsResult } from '../../types/api';

const { alertsMock } = vi.hoisted(() => ({ alertsMock: vi.fn() }));

vi.mock('../../lib/api', () => ({
  adminApi: { alerts: alertsMock },
}));

import { AdminAlertBell } from './AlertBell';

function makeAlerts(total: number, itemCount = 6): AdminAlertsResult {
  return {
    generatedAt: '2026-11-04T10:00:00.000Z',
    total,
    items: Array.from({ length: itemCount }, (_, index) => ({
      key: `alert-${index + 1}`,
      severity: 'warning' as const,
      category: 'ticket' as const,
      title: `告警 ${index + 1}`,
      detail: `详情 ${index + 1}`,
      count: index + 1,
      link: `/admin/tickets?id=ticket-${index + 1}`,
    })),
  };
}

beforeEach(() => {
  alertsMock.mockReset();
});

describe('AdminAlertBell', () => {
  it('显示条目数角标、最多展示前 5 条并支持跳转', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    alertsMock.mockResolvedValue(makeAlerts(120));
    render(<AdminAlertBell onNavigate={onNavigate} />);

    expect(await screen.findByTestId('admin-alert-badge')).toHaveTextContent('99+');
    await user.click(screen.getByTestId('admin-alert-trigger'));

    expect(await screen.findByText('告警 1')).toBeInTheDocument();
    expect(screen.getByText('告警 5')).toBeInTheDocument();
    expect(screen.queryByText('告警 6')).not.toBeInTheDocument();

    await user.click(screen.getByText('告警 1'));
    expect(onNavigate).toHaveBeenCalledWith('/admin/tickets?id=ticket-1');
  });

  it('没有待处理项时不显示 0 角标', async () => {
    const user = userEvent.setup();
    alertsMock.mockResolvedValue(makeAlerts(0, 0));
    render(<AdminAlertBell onNavigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('admin-alert-trigger')).toHaveAttribute('aria-label', '告警中心'));
    expect(screen.queryByTestId('admin-alert-badge')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('admin-alert-trigger'));
    expect(await screen.findByText('没有待处理告警')).toBeInTheDocument();
  });

  it('首次加载失败后可在下拉菜单内重试', async () => {
    const user = userEvent.setup();
    alertsMock
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce(makeAlerts(2, 2));
    render(<AdminAlertBell onNavigate={vi.fn()} />);

    await waitFor(() => expect(alertsMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('admin-alert-trigger'));

    expect(await screen.findByText('网络错误')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /重试/ }));

    await waitFor(() => expect(screen.getByTestId('admin-alert-badge')).toHaveTextContent('2'));
    expect(alertsMock).toHaveBeenCalledTimes(2);
  });
});
