import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UploadLimitsProvider } from '../../context/UploadLimitsContext';
import { ToolImageDropzone } from '../ToolImageDropzone';

const settings = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('../../lib/api-settings', () => ({
  publicSettingsApi: { read: settings.read },
  UPLOAD_LIMITS_CHANGED_EVENT: 'upload-limits:changed',
}));

describe('ToolImageDropzone 运行时限制同步', () => {
  it('后台调小 maxSizeMb 且收窄 allowedTypes 后，accept 与默认提示同步变化', async () => {
    settings.read.mockResolvedValue({
      upload: {
        maxSizeMb: 1,
        maxBytes: 1024 * 1024,
        maxPixels: 1_000_000,
        allowedTypes: 'gif',
        allowedMimes: ['image/gif'],
        allowedLabels: ['GIF'],
      },
    });

    render(
      <UploadLimitsProvider>
        <ToolImageDropzone
          title="上传商品图"
          images={[]}
          max={3}
          uploading={false}
          onFiles={vi.fn()}
          onRemove={vi.fn()}
          onOpenLibrary={vi.fn()}
          onOpenMobile={vi.fn()}
        />
      </UploadLimitsProvider>,
    );

    expect(await screen.findByText(/单张不超过 1MB/)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    await waitFor(() => expect(input).toHaveAttribute('accept', 'image/gif'));
  });
});
