import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AdminTaskRow } from '../types';

vi.mock('../api', () => ({
  assetThumbUrl: (url: string) => url,
}));

import { useTaskTableColumns } from '../TaskTableColumns';

const BASE_TASK: AdminTaskRow = {
  id: 'task-1',
  capability: 'main_image',
  capabilityName: '主图生成',
  status: 'failed',
  errorCode: 'MODEL_ERROR',
  creditCost: 10,
  retriedFromId: null,
  user: { id: 'user-1', email: 'user@example.com' },
  project: { id: 'project-1', name: '项目一' },
  durationMs: 1500,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.500Z',
  thumbnailUrl: null,
};

function renderOps(
  task: AdminTaskRow,
  can: (permission: string) => boolean,
  onAction = vi.fn(),
  onOpenDetail = vi.fn(),
) {
  const { result } = renderHook(() =>
    useTaskTableColumns({ can, onOpenDetail, onAction }),
  );
  const ops = result.current.find((column) => column.key === 'ops');
  if (!ops?.render) throw new Error('ops 列未定义');
  render(<MemoryRouter>{ops.render(task, 0)}</MemoryRouter>);
  return { onAction, onOpenDetail };
}

describe('任务表格操作列', () => {
  it('失败任务直显详情与重试，删除收进「更多」并交给确认流程', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderOps(BASE_TASK, () => true, onAction);

    expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    // 操作列只直显两个动作：删除是不可撤销的，收进菜单
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终止' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onAction).toHaveBeenCalledWith('retry', BASE_TASK);

    await user.click(screen.getByRole('button', { name: /更多操作/ }));
    await user.click(await screen.findByRole('menuitem', { name: '删除任务' }, { timeout: 3000 }));
    expect(onAction).toHaveBeenCalledWith('delete', BASE_TASK);
  });

  it('运行中任务按权限显示终止，不显示重试或删除', () => {
    renderOps(
      { ...BASE_TASK, status: 'running', errorCode: null },
      (permission) => permission === 'task.cancel',
    );

    expect(screen.getByRole('button', { name: '终止' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('无操作权限时终态任务仍保留详情入口', () => {
    renderOps({ ...BASE_TASK, status: 'succeeded', errorCode: null }, () => false);

    expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终止' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });
});
