import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminInviteListResult } from '../../../../types/api';
import type { InviteRow } from '../constants';

const { invitesMock, grantMock, toastMock, canDo } = vi.hoisted(() => ({
  invitesMock: vi.fn(),
  grantMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  canDo: { creditAdjust: true },
}));

vi.mock('../api', () => ({
  marketingApi: { invites: invitesMock, grantInviteReward: grantMock },
}));

/*
 * 只换掉两个外部上下文：`useAdmin`（不套 AdminProvider，免得为权限去发
 * /admin/me）与 `useToast`（断言调用而不是渲染出的 toast）。
 * 数据管线 `useAdminList` 用真实实现，请求参数与竞态处理才被测得到。
 */
vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks')>();
  return {
    ...actual,
    useAdmin: () =>
      ({
        can: (permission: string) => permission === 'credit.adjust' && canDo.creditAdjust,
      }) as unknown as ReturnType<typeof actual.useAdmin>,
    useToast: () => toastMock as unknown as ReturnType<typeof actual.useToast>,
  };
});

import { InviteRelationsTab } from '../InviteRelationsTab';

function inviteRow(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'rel-1',
    inviteCode: 'ABCD1234',
    inviterEmail: 'inviter@example.com',
    inviterName: '邀请人',
    inviteeEmail: 'invitee@example.com',
    inviteeName: '',
    boundAt: '2026-11-08T10:00:00.000Z',
    rewardStatus: 'pending',
    ...overrides,
  };
}

function listResult(items: InviteRow[]): AdminInviteListResult {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    summary: {
      pending: items.filter((row) => row.rewardStatus === 'pending').length,
      granted: items.filter((row) => row.rewardStatus === 'granted').length,
    },
  };
}

function renderTab() {
  return render(
    <MemoryRouter>
      <InviteRelationsTab />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  invitesMock.mockReset();
  grantMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  canDo.creditAdjust = true;
});

describe('InviteRelationsTab', () => {
  it('渲染绑定关系、奖励状态与全量摘要', async () => {
    invitesMock.mockResolvedValue(
      listResult([
        inviteRow(),
        inviteRow({
          id: 'rel-2',
          inviteCode: 'WXYZ9876',
          inviteeEmail: 'paid@example.com',
          inviteeName: '已付费用户',
          rewardStatus: 'granted',
        }),
      ]),
    );

    renderTab();

    expect(await screen.findByText('ABCD1234')).toBeInTheDocument();
    expect(screen.getByText('WXYZ9876')).toBeInTheDocument();
    // 人这一列是两行：姓名 + 可点的邮箱（跳用户页）
    expect(screen.getByText('邀请人')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'inviter@example.com' }),
    ).toHaveAttribute('href', '/admin/users?q=inviter%40example.com');
    expect(screen.getByText('待发放')).toBeInTheDocument();
    expect(screen.getByText('已发放')).toBeInTheDocument();
    expect(screen.getByText(/全量待发放 1 · 全量已发放 1/)).toBeInTheDocument();
  });

  it('补发奖励先确认，确认后按关系 id 调用并重载列表', async () => {
    invitesMock.mockResolvedValue(listResult([inviteRow()]));
    grantMock.mockResolvedValue({ granted: true, credits: 30 });

    renderTab();
    await screen.findByText('ABCD1234');

    await userEvent.click(screen.getByRole('button', { name: '补发奖励' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('手动补发邀请奖励');
    expect(grantMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: '确认补发' }));

    expect(grantMock).toHaveBeenCalledWith('rel-1');
    expect(toastMock.success).toHaveBeenCalledWith('已补发邀请奖励 30 积分');
    expect(invitesMock).toHaveBeenCalledTimes(2);
  });

  it('无 credit.adjust 时不给补发入口，但说明差哪个权限', async () => {
    canDo.creditAdjust = false;
    invitesMock.mockResolvedValue(listResult([inviteRow()]));

    renderTab();
    await screen.findByText('ABCD1234');

    expect(screen.queryByRole('button', { name: '补发奖励' })).not.toBeInTheDocument();
    expect(screen.getByText('需积分调整权限')).toBeInTheDocument();
  });

  it('已发放的关系没有补发按钮', async () => {
    invitesMock.mockResolvedValue(listResult([inviteRow({ rewardStatus: 'granted' })]));

    renderTab();
    await screen.findByText('ABCD1234');

    expect(screen.queryByRole('button', { name: '补发奖励' })).not.toBeInTheDocument();
  });

  it('空库给出下一步，而不是「暂无数据」', async () => {
    invitesMock.mockResolvedValue(listResult([]));

    renderTab();

    expect(await screen.findByText(/还没有邀请关系/)).toBeInTheDocument();
  });
});
