import { describe, expect, it, vi } from 'vitest';
import { AdminStorageController } from './storage.controller';
import type { StorageService, StorageConfigView } from '../storage/storage.service';

const fakeView: StorageConfigView = {
  fields: [],
  values: {},
  secretConfigured: {},
  secretMasked: {},
  source: 'db',
};

function makeController(storage: Record<string, unknown>) {
  return new AdminStorageController(storage as unknown as StorageService);
}

describe('AdminStorageController', () => {
  it('未启用的后端切换时返回业务错误而不是 500', async () => {
    const storage = {
      get: vi.fn(() => null),
      setActive: vi.fn(),
    };
    const controller = makeController(storage);

    let thrown: unknown;
    try {
      await controller.setActive('minio');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 40001,
      response: { code: 40001, message: '后端未启用: minio' },
    });
    expect(storage.setActive).not.toHaveBeenCalled();
  });

  it('status 返回 editable=true 且每个后端都带配置视图（含 local）', async () => {
    const localView: StorageConfigView = { ...fakeView, fields: [], source: 'none' };
    const storage = {
      activeBackend: 'local',
      status: vi.fn(async () => [
        { backend: 'local', available: true, configured: true, active: true, config: localView },
        { backend: 'oss', available: false, configured: false, active: false, config: fakeView },
      ]),
    };
    const controller = makeController(storage);

    const res = await controller.status();

    expect(res.editable).toBe(true);
    expect(res.backends).toHaveLength(2);
    expect(res.backends[0].config).toEqual(localView);
    expect(res.backends[1].config).toEqual(fakeView);
    expect(res.credentialSource).toContain('存储配置页');
  });

  it('saveConfig 把操作人 id 传给服务层审计', async () => {
    const storage = {
      saveConfig: vi.fn(async () => fakeView),
    };
    const controller = makeController(storage);

    const res = await controller.saveConfig(
      'oss',
      { values: { region: 'cn-hangzhou' } },
      { id: 'admin-42', email: 'a@b.c', role: 'admin' },
    );

    expect(storage.saveConfig).toHaveBeenCalledWith(
      'oss',
      { region: 'cn-hangzhou' },
      'admin-42',
    );
    expect(res.backend).toBe('oss');
    expect(res.config).toEqual(fakeView);
  });

  it('saveConfig 允许保存 local 的公开访问地址', async () => {
    const storage = { saveConfig: vi.fn(async () => fakeView) };
    const controller = makeController(storage);

    const res = await controller.saveConfig(
      'local',
      { values: { publicBaseUrl: 'https://cdn.example.com' } },
      { id: 'admin-42', email: 'a@b.c', role: 'admin' },
    );

    expect(storage.saveConfig).toHaveBeenCalledWith(
      'local',
      { publicBaseUrl: 'https://cdn.example.com' },
      'admin-42',
    );
    expect(res.backend).toBe('local');
  });

  it('saveConfig 拒绝非法后端', async () => {
    const storage = { saveConfig: vi.fn(async () => fakeView) };
    const controller = makeController(storage);

    let thrown: unknown;
    try {
      await controller.saveConfig(
        'ftp',
        { values: {} },
        { id: 'admin-42', email: 'a@b.c', role: 'admin' },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 40001 });
    expect(storage.saveConfig).not.toHaveBeenCalled();
  });

  it('probe 带 values 时走草稿测试而不是已保存 provider', async () => {
    const storage = {
      testDraft: vi.fn(async () => ({ ok: true, message: '读写正常', latencyMs: 12 })),
      get: vi.fn(() => null),
      getActive: vi.fn(),
    };
    const controller = makeController(storage);

    const res = await controller.probe('oss', { values: { bucket: 'b' } });

    expect(storage.testDraft).toHaveBeenCalledWith('oss', { bucket: 'b' });
    expect(res).toMatchObject({ backend: 'oss', ok: true });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('probe 不带 values 时探测已保存的 provider', async () => {
    const probe = vi.fn(async () => ({ ok: false, message: '连通失败' }));
    const storage = {
      get: vi.fn(() => ({ backend: 'oss', probe })),
    };
    const controller = makeController(storage);

    const res = await controller.probe('oss');

    expect(storage.get).toHaveBeenCalledWith('oss');
    expect(probe).toHaveBeenCalledWith({ verifyWrite: true });
    expect(res).toMatchObject({ backend: 'oss', ok: false });
  });
});
