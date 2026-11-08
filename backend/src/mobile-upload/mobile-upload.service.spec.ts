import { describe, expect, it, vi } from 'vitest';

import { MobileUploadService, MOBILE_UPLOAD_MAX_TOTAL_BYTES } from './mobile-upload.service';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function setup(options: { transactionError?: unknown } = {}) {
  const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: `asset-${create.mock.calls.length}`, ...data }),
  );
  const tx = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: 'project-1' }) },
    asset: { create },
  };
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue({ ownerId: 'owner-1' }) },
    $transaction: options.transactionError
      ? vi.fn().mockRejectedValue(options.transactionError)
      : vi.fn().mockImplementation((cb: (client: typeof tx) => unknown) => cb(tx)),
  };
  const provider = {
    backend: 'local',
    put: vi.fn().mockResolvedValue({ key: '', sizeBytes: PNG_1X1.length, contentType: 'image/png' }),
    url: vi.fn().mockResolvedValue('/uploads/original/test.png'),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    getActive: vi.fn().mockReturnValue(provider),
    buildKey: vi.fn((_category: string, ext: string) => `original/test.${ext}`),
  };
  const signedUrl = { sign: vi.fn().mockReturnValue('signed://asset') };
  const service = new MobileUploadService(prisma as never, storage as never, signedUrl as never);
  return { service, prisma, provider, create };
}

async function newSession(service: MobileUploadService) {
  return service.create('owner-1', 'project-1');
}

describe('MobileUploadService 手机上传边界', () => {
  it('完整校验后写入真实 MIME 与像素尺寸', async () => {
    const { service, create } = setup();
    const session = await newSession(service);

    const result = await service.receive(session.id, session.token, [
      { filename: 'phone.png', mimetype: 'application/octet-stream', size: PNG_1X1.length, data: PNG_1X1 },
    ]);

    expect(result.status).toBe('received');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        format: 'image/png',
        width: 1,
        height: 1,
        sizeBytes: PNG_1X1.length,
      }),
    });
  });

  it('只有图片魔数但无法解码时整批拒绝，并恢复 waiting', async () => {
    const { service, provider } = setup();
    const session = await newSession(service);
    const fake = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.alloc(32)]);

    await expect(
      service.receive(session.id, session.token, [
        { filename: 'fake.png', mimetype: 'image/png', size: fake.length, data: fake },
      ]),
    ).rejects.toMatchObject({ code: 40001 });
    expect(provider.put).not.toHaveBeenCalled();
    expect(service.status('owner-1', session.id).status).toBe('waiting');
  });

  it('并发提交只有一个进入 receiving，另一个立即冲突', async () => {
    const { service, provider } = setup();
    const session = await newSession(service);
    let release!: () => void;
    provider.put.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ key: '', sizeBytes: PNG_1X1.length, contentType: 'image/png' });
      }),
    );
    const file = { filename: 'phone.png', mimetype: 'image/png', size: PNG_1X1.length, data: PNG_1X1 };

    const first = service.receive(session.id, session.token, [file]);
    while (!release) await Promise.resolve();
    await expect(service.receive(session.id, session.token, [file])).rejects.toMatchObject({
      code: 40900,
      status: 409,
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'received' });
  });

  it('超过整批总大小时在读取和写存储前拒绝', async () => {
    const { service, provider } = setup();
    const session = await newSession(service);
    const half = MOBILE_UPLOAD_MAX_TOTAL_BYTES / 2 + 1;
    const file = { filename: 'phone.png', mimetype: 'image/png', size: half, data: PNG_1X1 };

    await expect(service.receive(session.id, session.token, [file, file])).rejects.toMatchObject({
      code: 40001,
      message: expect.stringContaining('总大小'),
    });
    expect(provider.put).not.toHaveBeenCalled();
  });

  it('事务失败时清理已写入对象并允许重试', async () => {
    const { service, provider } = setup({ transactionError: new Error('db unavailable') });
    const session = await newSession(service);
    const file = { filename: 'phone.png', mimetype: 'image/png', size: PNG_1X1.length, data: PNG_1X1 };

    await expect(service.receive(session.id, session.token, [file])).rejects.toThrow('db unavailable');

    expect(provider.delete).toHaveBeenCalledOnce();
    expect(service.status('owner-1', session.id).status).toBe('waiting');
  });

  it('上传进行中被电脑端取消时不会继续入库', async () => {
    const { service, provider, create } = setup();
    const session = await newSession(service);
    let release!: () => void;
    provider.put.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ key: '', sizeBytes: PNG_1X1.length, contentType: 'image/png' });
      }),
    );
    const file = { filename: 'phone.png', mimetype: 'image/png', size: PNG_1X1.length, data: PNG_1X1 };

    const pending = service.receive(session.id, session.token, [file]);
    await vi.waitFor(() => expect(provider.put).toHaveBeenCalledOnce());
    service.cancel('owner-1', session.id);
    release();

    await expect(pending).rejects.toMatchObject({ code: 40900 });
    expect(create).not.toHaveBeenCalled();
    expect(provider.delete).toHaveBeenCalledOnce();
  });
});
