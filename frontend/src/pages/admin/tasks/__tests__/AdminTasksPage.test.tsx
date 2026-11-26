import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../GenerationTasksTab', () => ({
  GenerationTasksTab: () => <div>生成任务内容</div>,
}));

import { AdminTasksPage } from '../page';

describe('AdminTasksPage', () => {
  it('只渲染生成任务内容', () => {
    render(
      <MemoryRouter initialEntries={['/admin/tasks']}>
        <AdminTasksPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('生成任务内容')).toBeInTheDocument();
  });
});
