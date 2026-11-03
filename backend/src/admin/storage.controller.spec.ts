import { describe, expect, it, vi } from 'vitest';
import { AdminStorageController } from './storage.controller';
import type { StorageService } from '../storage/storage.service';

describe('AdminStorageController', () => {
  it('未启用的后端切换时返回业务错误而不是 500', () => {
    const storage = {
      get: vi.fn(() => null),
      setActive: vi.fn(),
    };
    const controller = new AdminStorageController(storage as unknown as StorageService);

    let thrown: unknown;
    try {
      controller.setActive('minio');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 40001,
      response: { code: 40001, message: '后端未启用: minio' },
    });
    expect(storage.setActive).not.toHaveBeenCalled();
  });
});
