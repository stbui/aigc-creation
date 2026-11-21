import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeKey,
  maskSecret,
  MinioStorageProvider,
  OssStorageProvider,
} from './storage.provider';

/**
 * 云端 provider 单测。
 *
 * SDK 刻意不进 package.json（本地开发零云依赖），因此单测走构造函数注入的
 * client：不 mock 模块、不联网、不碰真实 bucket，只验证 provider 自己的契约 ——
 * key 校验、字节口径、探测语义、凭据脱敏。
 */

function ossClient() {
  const store = new Map<string, Buffer>();
  return {
    store,
    put: vi.fn(async (key: string, data: Buffer) => {
      store.set(key, data);
      // 故意让响应 content-length 与真实对象大小不同：修复前 put 取的就是这个值
      return { res: { headers: { 'content-length': '2' } } };
    }),
    get: vi.fn(async (key: string) => ({ content: store.get(key) })),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    head: vi.fn(async (key: string) => {
      if (!store.has(key)) throw new Error('not found');
    }),
    list: vi.fn(async () => ({ objects: [] })),
    signatureUrl: vi.fn((key: string) => `https://oss.example/${key}?sign=1`),
  };
}

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

const OSS_CFG = {
  region: 'oss-cn-hangzhou',
  bucket: 'test-bucket',
  accessKeyId: 'LTAI1234567890abcd',
  accessKeySecret: 'secret-value',
};

const MINIO_CFG = {
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: 'minio-access',
  secretKey: 'minio-secret',
  bucket: 'huojue',
};

describe('OssStorageProvider', () => {
  it('put 以实际写入字节数为准，不取上传响应 content-length', async () => {
    const client = ossClient();
    const p = new OssStorageProvider(OSS_CFG, client);
    const data = Buffer.from('hello-world');

    const res = await p.put('original/202611/a.png', data, 'image/png');

    expect(res.sizeBytes).toBe(data.byteLength);
    expect(res.contentType).toBe('image/png');
    expect(client.store.get('original/202611/a.png')?.equals(data)).toBe(true);
  });

  it('get / exists / delete / url 走同一 key 且拦截非法 key', async () => {
    const client = ossClient();
    const p = new OssStorageProvider(OSS_CFG, client);
    await p.put('a/b.png', Buffer.from('x'), 'image/png');

    expect(await p.exists('a/b.png')).toBe(true);
    expect(await p.exists('a/missing.png')).toBe(false);
    expect((await p.get('a/b.png')).toString()).toBe('x');
    expect(await p.url('a/b.png')).toContain('a/b.png');
    await p.delete('a/b.png');
    expect(client.store.has('a/b.png')).toBe(false);
    await expect(p.put('../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow();
  });

  it('probe 默认只读，不写对象', async () => {
    const client = ossClient();
    const p = new OssStorageProvider(OSS_CFG, client);

    const res = await p.probe();

    expect(res.ok).toBe(true);
    expect(res.message).toContain('只读探测');
    expect(client.list).toHaveBeenCalledOnce();
    expect(client.put).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it('probe({ verifyWrite: true }) 写探针、读回并删除', async () => {
    const client = ossClient();
    const p = new OssStorageProvider(OSS_CFG, client);

    const res = await p.probe({ verifyWrite: true });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('读写正常');
    expect(client.put).toHaveBeenCalledOnce();
    expect(client.get).toHaveBeenCalledOnce();
    expect(client.delete).toHaveBeenCalledOnce();
    expect(client.store.size).toBe(0);
  });

  it('读回内容不一致时探测失败，但仍清理探针', async () => {
    const client = ossClient();
    client.get.mockImplementation(async () => ({ content: Buffer.from('tampered') }));
    const p = new OssStorageProvider(OSS_CFG, client);

    const res = await p.probe({ verifyWrite: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('读回内容与写入不一致');
    expect(client.delete).toHaveBeenCalledOnce();
  });

  it('连通失败返回诊断信息而不是抛异常', async () => {
    const client = ossClient();
    client.list.mockRejectedValue(new Error('AccessDenied'));
    const p = new OssStorageProvider(OSS_CFG, client);

    const res = await p.probe();

    expect(res.ok).toBe(false);
    expect(res.message).toContain('AccessDenied');
  });

  it('credentialStatus 只回脱敏值，不泄漏明文密钥', () => {
    const p = new OssStorageProvider(OSS_CFG, ossClient());

    const status = p.credentialStatus();

    expect(status.configured).toBe(true);
    expect(status.masked).toBe('****abcd');
    expect(status.endpoint).toContain('test-bucket');
    expect(JSON.stringify(status)).not.toContain(OSS_CFG.accessKeySecret);
  });

  it('配置公开域名后 url 直读、不签名；未配置时按有效期签名', async () => {
    const signed = new OssStorageProvider(
      { ...OSS_CFG, urlExpiresSeconds: 120 },
      ossClient(),
    );
    expect(await signed.url('a/b.png')).toContain('sign=1');

    const cdn = new OssStorageProvider(
      { ...OSS_CFG, publicBaseUrl: 'https://media.example.com/' },
      ossClient(),
    );
    expect(await cdn.url('a/b.png')).toBe('https://media.example.com/a/b.png');
  });

  it('STS 临时凭证透传给 SDK（注入 client 时不构造，仅验证不抛错）', () => {
    expect(
      () => new OssStorageProvider({ ...OSS_CFG, sessionToken: 'sts-token' }, ossClient()),
    ).not.toThrow();
  });

  it('probe 失败时给出步骤与目标桶 / 地域', async () => {
    const client = ossClient();
    client.list.mockRejectedValue(new Error('AccessDenied'));
    const p = new OssStorageProvider(OSS_CFG, client);

    const res = await p.probe();

    expect(res.message).toContain('AccessDenied');
    expect(res.message).toContain('test-bucket');
    expect(res.message).toContain(OSS_CFG.region);
  });
});

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

describe('key 与脱敏工具', () => {
  it('拒绝目录穿越 / 绝对路径 / 反斜杠 / 非法字符', () => {
    for (const key of ['../etc/passwd', '/etc/passwd', 'a\\b', '', 'a b.png']) {
      expect(() => assertSafeKey(key)).toThrow();
    }
    expect(() => assertSafeKey('original/202611/a-b_c.png')).not.toThrow();
  });

  it('maskSecret 只保留末 4 位且短值全遮蔽', () => {
    expect(maskSecret('abcdefgh')).toBe('****efgh');
    expect(maskSecret('abc')).toBe('****');
    expect(maskSecret(undefined)).toBeUndefined();
  });
});
