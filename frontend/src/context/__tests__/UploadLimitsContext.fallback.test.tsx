import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { UploadLimitsProvider, useUploadLimits } from '../UploadLimitsContext';

const settings = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('../../lib/api-settings', () => ({
  publicSettingsApi: { read: settings.read },
  UPLOAD_LIMITS_CHANGED_EVENT: 'upload-limits:changed',
}));

function wrapper({ children }: { children: ReactNode }) {
  return <UploadLimitsProvider>{children}</UploadLimitsProvider>;
}

function imageFile(name: string, size: number, type = 'image/png'): File {
  const file = new File(['image'], name, { type });
  Object.defineProperty(file, 'size', { configurable: true, value: size });
  return file;
}

describe('UploadLimits 兜底路径', () => {
  beforeEach(() => {
    settings.read.mockReset();
  });

  it('设置接口失败时仍暴露自洽的运行时值，并能给出超限错误', async () => {
    settings.read.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useUploadLimits(), { wrapper });

    await waitFor(() => expect(settings.read).toHaveBeenCalled());

    expect(result.current.accept).toBe('image/png,image/jpeg,image/webp');
    expect(result.current.allowedLabel).toBe('PNG / JPG / WebP');
    expect(result.current.maxMb).toBe(10);
    expect(result.current.maxPixels).toBeGreaterThan(0);

    await expect(
      result.current.validateImageFile(imageFile('big.png', 10 * 1024 * 1024 + 1)),
    ).resolves.toBe('单张图片不能超过 10MB');
    await expect(
      result.current.validateImageFile(imageFile('notes.txt', 1024, 'text/plain')),
    ).resolves.toBe('请选择 PNG / JPG / WebP 格式的图片');

    expect(result.current.allowedLabel).not.toContain('undefined');
    expect(result.current.accept).not.toContain('undefined');
  });
});
