import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PluginView } from '~/types/model';
import { PluginTable } from '../PluginTable';

const BASE: PluginView = {
  id: 'cangyuan-midjourney',
  name: '沧元 Midjourney',
  version: '1.0.0',
  vendor: '沧元算力 / 影绘',
  origin: 'builtin',
  enabled: true,
  removable: false,
  activeProtocols: 2,
  availability: { available: true },
  providers: [
    { id: 'p1', label: '沧元 Midjourney V7', registered: true },
    { id: 'p2', label: '沧元 Midjourney V6', registered: true },
    { id: 'p3', label: '沧元 Niji', registered: false },
  ],
  verify: null,
  contribution: null,
} as unknown as PluginView;

function renderTable(row: PluginView) {
  const handlers = {
    onDetail: vi.fn(),
    onVerify: vi.fn(),
    onToggle: vi.fn(),
    onUninstall: vi.fn(),
  };
  render(
    <PluginTable
      items={[row]}
      loading={false}
      error={null}
      writable
      busy={null}
      onRetry={vi.fn()}
      {...handlers}
    />,
  );
  return handlers;
}

describe('插件表格', () => {
  it('Provider 超两项时只直显两个，其余折成 +N', () => {
    renderTable(BASE);
    const body = screen.getAllByRole('row')[1];
    expect(within(body).getByText('沧元 Midjourney V7')).toBeInTheDocument();
    expect(within(body).getByText('沧元 Midjourney V6')).toBeInTheDocument();
    expect(within(body).queryByText('沧元 Niji')).not.toBeInTheDocument();
    expect(within(body).getByText('+1')).toBeInTheDocument();
  });

  it('操作列直显两个动作，校验与卸载收进「更多」', async () => {
    const user = userEvent.setup();
    const handlers = renderTable({ ...BASE, removable: true });
    const body = screen.getAllByRole('row')[1];

    const direct = within(body).getAllByRole('button').filter((b) => !b.getAttribute('aria-label'));
    expect(direct.map((b) => b.textContent)).toEqual(['详情', '停用']);

    await user.click(within(body).getByRole('button', { name: /更多操作/ }));
    await user.click(await screen.findByRole('menuitem', { name: '校验契约' }, { timeout: 3000 }));
    expect(handlers.onVerify).toHaveBeenCalledTimes(1);

    await user.click(within(body).getByRole('button', { name: /更多操作/ }));
    await user.click(await screen.findByRole('menuitem', { name: '卸载插件' }, { timeout: 3000 }));
    expect(handlers.onUninstall).toHaveBeenCalledTimes(1);
  });
});
