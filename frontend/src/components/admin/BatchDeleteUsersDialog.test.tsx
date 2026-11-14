import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  BATCH_DELETE_LIMIT,
  type BatchDeleteTarget,
  BatchDeleteUsersDialog,
} from './BatchDeleteUsersDialog';

function makeTarget(index: number): BatchDeleteTarget {
  return {
    id: `user-${index}`,
    email: `user${index}@example.com`,
    projectCount: 1,
    taskCount: 2,
    assetCount: 3,
  };
}

describe('BatchDeleteUsersDialog', () => {
  it('无需键入确认词即可提交，聚合口径取自行上的计数', async () => {
    const onConfirm = vi.fn();
    render(
      <BatchDeleteUsersDialog
        targets={[makeTarget(1), makeTarget(2)]}
        loading={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole('button', { name: '确认删除 2 个' });
    expect(screen.queryByLabelText('删除确认词')).not.toBeInTheDocument();
    expect(confirm).toBeEnabled();
    expect(screen.getByText('项目 2 · 任务 4 · 素材 6')).toBeInTheDocument();

    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('没有计数时用调用方给的清除说明（积分账本页的行不带项目/素材数）', () => {
    render(
      <BatchDeleteUsersDialog
        targets={[{ id: 'user-1', email: 'a@example.com' }]}
        clearedNote="积分批次与余额（合计 120 积分）、作品、任务、素材"
        loading={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText('积分批次与余额（合计 120 积分）、作品、任务、素材'),
    ).toBeInTheDocument();
  });

  it('超过单次上限时提示分批，并锁住提交', () => {
    const targets = Array.from({ length: BATCH_DELETE_LIMIT + 1 }, (_, index) => makeTarget(index));

    render(
      <BatchDeleteUsersDialog
        targets={targets}
        loading={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText(new RegExp(`单次最多删除 ${BATCH_DELETE_LIMIT} 个账号`)),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('删除确认词')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `确认删除 ${BATCH_DELETE_LIMIT + 1} 个` }),
    ).toBeDisabled();
  });
});
