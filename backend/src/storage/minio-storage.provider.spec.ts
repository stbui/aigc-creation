import { describe, expect, it, vi } from 'vitest';
import { MinioStorageProvider } from './minio-storage.provider';

/**
 * MinIO provider 单测。
 *
 * SDK 刻意不进 package.json（本地开发零云依赖），因此单测走构造函数注入的
 * client：不 mock 模块、不联网、不碰真实 bucket，只验证 provider 自己的契约 ——
 * key 校验、流式读回、探测语义、凭据脱敏。
 */

function minioClient() {
  const store = new Map<string, Buffer>();
  return {
    store,
    putObject: vi.fn(async (_bucket: string, key: string, data: Buffer) => {
      store.set(key, data);
    }),
    getObject: vi.fn(async (_bucket: string, key: string) => {
      const value = store.get(key);
      return (async function* () {
        yield value ?? Buffer.alloc(0);
      })();
    }),
    removeObject: vi.fn(async (_bucket: string, key: string) => {
      store.delete(key);
    }),
    statObject: vi.fn(async (_bucket: string, key: string) => {
      if (!store.has(key)) throw new Error('not found');
    }),
    bucketExists: vi.fn(async () => true),
    makeBucket: vi.fn(async () => undefined),
    presignedGetObject: vi.fn(
      (bucket: string, key: string) => `https://minio.example/${bucket}/${key}`,
    ),
  };
}

const MINIO_CFG = {
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: 'minio-access',
  secretKey: 'minio-secret',
  bucket: 'huojue',
};

describe('MinioStorageProvider', () => {
  it('put / get 流式读回，sizeBytes 为实际字节数', async () => {
    const client = minioClient();
    const p = new MinioStorageProvider(MINIO_CFG, client);
    const data = Buffer.from('minio-payload');

    const res = await p.put('generated/task/t1/output-0.png', data, 'image/png');

    expect(res.sizeBytes).toBe(data.byteLength);
    expect((await p.get(res.key)).equals(data)).toBe(true);
  });

  it('probe 默认只读；verifyWrite 时写探针并删除', async () => {
    const client = minioClient();
    const p = new MinioStorageProvider(MINIO_CFG, client);

    const readOnly = await p.probe();
    expect(readOnly.ok).toBe(true);
    expect(readOnly.message).toContain('只读探测');
    expect(client.putObject).not.toHaveBeenCalled();

    const full = await p.probe({ verifyWrite: true });
    expect(full.ok).toBe(true);
    expect(full.message).toContain('读写正常');
    expect(client.putObject).toHaveBeenCalledOnce();
    expect(client.removeObject).toHaveBeenCalledOnce();
    expect(client.store.size).toBe(0);
  });

  it('bucket 不存在时明确报出桶名', async () => {
    const client = minioClient();
    client.bucketExists.mockResolvedValue(false);
    const p = new MinioStorageProvider(MINIO_CFG, client);

    const res = await p.probe();

    expect(res.ok).toBe(false);
    expect(res.message).toContain('huojue');
  });

  it('exists / delete / url 与凭据脱敏', async () => {
    const client = minioClient();
    const p = new MinioStorageProvider(MINIO_CFG, client);
    await p.put('a/b.png', Buffer.from('x'), 'image/png');

    expect(await p.exists('a/b.png')).toBe(true);
    expect(await p.exists('a/none.png')).toBe(false);
    expect(await p.url('a/b.png')).toContain('huojue/a/b.png');
    await p.delete('a/b.png');
    expect(client.store.has('a/b.png')).toBe(false);

    const status = p.credentialStatus();
    expect(status.masked).toBe('****cess');
    expect(JSON.stringify(status)).not.toContain(MINIO_CFG.secretKey);
  });

  it('配置公开域名后 url 直读', async () => {
    const client = minioClient();
    const p = new MinioStorageProvider(
      { ...MINIO_CFG, publicBaseUrl: 'https://cdn.example.com' },
      client,
    );
    expect(await p.url('a/b.png')).toBe('https://cdn.example.com/a/b.png');
  });

  it('桶不存在且未开启自动创建时明确报出桶名', async () => {
    const client = minioClient();
    client.bucketExists.mockResolvedValue(false);
    client.makeBucket = vi.fn();
    const p = new MinioStorageProvider(MINIO_CFG, client);

    const res = await p.probe();

    expect(res.ok).toBe(false);
    expect(res.message).toContain('huojue');
    expect(client.makeBucket).not.toHaveBeenCalled();
  });

  it('开启自动创建后会创建桶并继续探测', async () => {
    const client = minioClient();
    client.bucketExists.mockResolvedValue(false);
    client.makeBucket = vi.fn(async () => undefined);
    const p = new MinioStorageProvider({ ...MINIO_CFG, autoCreateBucket: true }, client);

    const res = await p.probe();

    expect(client.makeBucket).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });
});