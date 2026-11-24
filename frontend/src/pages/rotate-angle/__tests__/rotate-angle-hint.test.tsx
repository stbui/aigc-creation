import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RotateAnglePage } from '../page';

const { runtimeLabel } = vi.hoisted(() => ({ runtimeLabel: 'AVIF / PNG' }));

vi.mock('../../../context/UploadLimitsContext', () => ({
  useUploadLimits: () => ({ allowedLabel: runtimeLabel }),
}));

vi.mock('../../../ui', () => ({
  useApp: () => ({
    message: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
    modal: { confirm: vi.fn() },
  }),
}));

vi.mock('../components', () => ({
  PRODUCT_TOOL_DROPZONE: '',
  PRODUCT_TOOL_PAGE: '',
  ToolHistoryPane: () => null,
  ToolShell: ({ upload }: { upload: { hint?: string } }) => (
    <div data-testid="upload-hint">{upload.hint}</div>
  ),
  productSourcePane: () => null,
  productSourceUploadPreview: () => null,
}));

vi.mock('../RotateAngleSettingsCard', () => ({ RotateAngleSettingsCard: () => null }));
vi.mock('../hooks', () => ({
  useToolTask: () => ({ submitting: false, result: null, setResult: vi.fn(), run: vi.fn() }),
}));

describe('rotate-angle upload hint', () => {
  it('使用运行时 allowedLabel 而不是固定格式列表', () => {
    render(<RotateAnglePage />);
    const hint = screen.getByTestId('upload-hint').textContent ?? '';
    expect(hint).toContain(runtimeLabel);
    expect(hint).toContain('最多 1 张');
    expect(hint).not.toContain('JPG');
  });
});
