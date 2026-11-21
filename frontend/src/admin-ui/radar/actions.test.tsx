import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExportCsvButton, RefreshButton } from './actions';

describe('ExportCsvButton', () => {
  it('触发导出并在导出中禁用按钮、切换文案', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const { rerender } = render(<ExportCsvButton onExport={onExport} />);

    await user.click(screen.getByRole('button', { name: '导出 CSV' }));
    expect(onExport).toHaveBeenCalledOnce();

    rerender(<ExportCsvButton onExport={onExport} exporting />);
    const exporting = screen.getByRole('button', { name: '导出中…' });
    expect(exporting).toBeDisabled();
  });

  it('支持页面自定义可访问名称', () => {
    render(<ExportCsvButton onExport={vi.fn()} ariaLabel="导出用户 CSV" />);

    expect(screen.getByRole('button', { name: '导出用户 CSV' })).toBeInTheDocument();
  });
});

describe('RefreshButton', () => {
  it('触发刷新并在加载中禁用按钮', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { rerender } = render(<RefreshButton onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(onRefresh).toHaveBeenCalledOnce();

    rerender(<RefreshButton onRefresh={onRefresh} loading />);
    expect(screen.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  });

  it('无点击回调时仍可用于禁用占位状态', () => {
    render(<RefreshButton disabled />);

    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled();
  });
});
