import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { can } = vi.hoisted(() => ({ can: vi.fn() }));

vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks')>();
  return {
    ...actual,
    useAdmin: () =>
      ({ can }) as unknown as ReturnType<typeof actual.useAdmin>,
  };
});

vi.mock('../GenerationTasksTab', () => ({
  GenerationTasksTab: () => <div>生成任务内容</div>,
}));

vi.mock('../AiAnalysisMonitor', () => ({
  AiAnalysisMonitor: () => <div>AI 分析内容</div>,
}));

import { AdminTasksPage } from '../page';

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminTasksPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  can.mockReset();
});

describe('AdminTasksPage', () => {
  it('无 model.call_read 时不显示 AI 分析标签或内容', () => {
    can.mockReturnValue(false);

    renderPage('/admin/tasks?tab=ai-analysis');

    expect(screen.getByText('生成任务')).toBeInTheDocument();
    expect(screen.getByText('生成任务内容')).toBeInTheDocument();
    expect(screen.queryByText('AI 分析')).not.toBeInTheDocument();
    expect(screen.queryByText('AI 分析内容')).not.toBeInTheDocument();
  });

  it('有 model.call_read 时按 URL 打开 AI 分析标签', () => {
    can.mockImplementation((permission: string) => permission === 'model.call_read');

    renderPage('/admin/tasks?tab=ai-analysis');

    expect(screen.getByRole('tab', { name: 'AI 分析' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.getByText('AI 分析内容')).toBeInTheDocument();
    expect(screen.queryByText('生成任务内容')).not.toBeInTheDocument();
  });
});
