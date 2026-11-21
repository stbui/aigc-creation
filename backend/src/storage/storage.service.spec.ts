import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService, STORAGE_CONFIG_FIELDS, type StorageConfigValues } from './storage.service';

/**
 * StorageService 的配置中心行为单测。
 *
 * 不碰真实 SDK / 云 / 磁盘：
 * - config 用最小 ConfigService mock（只提供 path.uploads）；
 * - prisma 用内存 Map 模拟 storageConfig 表（findUnique/upsert）；
 * - cipher 用可逆的假加密（加/去前缀），验证「存的是密文、读时解密」链路，
 *   不依赖 MODEL_SECRET_KEY 或密钥文件。
 */

interface FakeRow {
  backend: string;
  configCipher: string;
  configDigest: string;
  updatedBy: string | null;
  active: boolean;
  updatedAt?: Date;
}

function fakeCipher() {
  return {
    encrypt: (plain: string) => (plain === '' ? '' : `enc:fake:${Buffer.from(plain).toString('base64')}`),
    decrypt: (cipher: string) =>
      cipher.startsWith('enc:fake:')
        ? Buffer.from(cipher.slice('enc:fake:'.length), 'base64').toString()
        : cipher,
  };
}

function fakePrisma(rows: Map<string, FakeRow> = new Map()) {
  const tx = {
    storageConfig: {
      updateMany: vi.fn(async () => undefined),
      update: vi.fn(async ({ where }: { where: { backend: string } }) => rows.get(where.backend)),
    },
  };
  return {
    rows,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    storageConfig: {
      findUnique: vi.fn(async ({ where }: { where: { backend: string } }) =>
        rows.get(where.backend) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { backend: string };
          create: FakeRow;
          update: Partial<FakeRow>;
        }) => {
          const row = { ...create, ...update, backend: where.backend, updatedAt: new Date() };
          rows.set(where.backend, row);
          return row;
        },
      ),
    },
  };
}

function makeService(prisma: ReturnType<typeof fakePrisma>, env: Record<string, string> = {}) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const config = { get: () => 'uploads' };
  const service = new StorageService(
    config as never,
    prisma as never,
    fakeCipher() as never,
  );
  return {
    service,
    restore: () => {
      process.env = saved;
    },
  };
}

const OSS_VALUES: StorageConfigValues = {
  region: 'oss-cn-hangzhou',
  bucket: 'my-bucket',
  accessKeyId: 'LTAI000000000000abcd',
  accessKeySecret: 'super-secret-value',
  endpoint: '',
};

describe('StorageService 配置中心', () => {
  beforeEach(() => {
    delete process.env.STORAGE_BACKEND;
    for (const k of ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_ENDPOINT']) {
      delete process.env[k];
    }
  });

  it('字段定义把密钥标为 secret，status 视图不返回明文密钥', () => {
    const fields = STORAGE_CONFIG_FIELDS.oss;
    expect(fields.find((f) => f.name === 'accessKeySecret')?.secret).toBe(true);
    expect(fields.find((f) => f.name === 'region')?.secret).toBeUndefined();

    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    const view = service.configView('oss');
    restore();

    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain('super-secret');
    expect(view!.secretConfigured.accessKeySecret).toBe(false);
  });

  it('DB 无配置时不读取环境变量，保持未启用', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma, {
      OSS_REGION: OSS_VALUES.region,
      OSS_BUCKET: OSS_VALUES.bucket,
      OSS_ACCESS_KEY_ID: OSS_VALUES.accessKeyId,
      OSS_ACCESS_KEY_SECRET: OSS_VALUES.accessKeySecret,
    });
    await service.onModuleInit();
    const view = service.configView('oss');
    restore();

    expect(view!.source).toBe('none');
    expect(view!.values.region).toBe('');
    expect(view!.secretConfigured.accessKeyId).toBe(false);
    expect(service.get('oss')).toBeNull();
  });

  it('saveConfig 加密落库并即时生效，密钥留空沿用旧值', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();

    await service.saveConfig('oss', OSS_VALUES, 'admin-1');
    // 改 bucket，密钥全部留空
    await service.saveConfig('oss', { region: 'oss-cn-shanghai', bucket: 'new-bucket', accessKeyId: '', accessKeySecret: '', endpoint: '' }, 'admin-1');
    const view = service.configView('oss');

    // 内存即时生效
    expect(view!.values.bucket).toBe('new-bucket');
    expect(view!.secretConfigured.accessKeyId).toBe(true);
    // 落库的是密文，不含明文密钥
    const row = prisma.rows.get('oss')!;
    expect(row.configCipher.startsWith('enc:fake:')).toBe(true);
    expect(row.configCipher).not.toContain(OSS_VALUES.accessKeySecret);
    expect(row.updatedBy).toBe('admin-1');
    expect(row.active).toBe(false);
    restore();
  });

  it('从 DB 读取配置并归一化字段', async () => {
    const rows = new Map<string, FakeRow>([
      [
        'minio',
        {
          backend: 'minio',
          configCipher: fakeCipher().encrypt(
            JSON.stringify({
              endPoint: 'db.minio.local',
              port: '9000',
              useSSL: 'false',
              accessKey: 'db-access',
              secretKey: 'db-secret',
              bucket: 'huojue',
            }),
          ),
          configDigest: 'x',
          updatedBy: null,
          active: false,
        },
      ],
    ]);
    const prisma = fakePrisma(rows);
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();
    const view = service.configView('minio');
    restore();

    expect(view!.source).toBe('db');
    expect(view!.values.endPoint).toBe('db.minio.local');
    expect(view!.secretMasked.accessKey).toBe('****cess');
  });

  it('没有数据库默认后端时固定使用 local', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();
    restore();

    expect(service.activeBackend).toBe('local');
  });

  it('必填项不全时配置不完整，provider 不注册', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma, { OSS_REGION: 'oss-cn-hangzhou' });
    await service.onModuleInit();
    restore();

    expect(service.get('oss')).toBeNull();
    expect(service.configView('oss').source).toBe('none');
  });

  it('saveConfig 校验必填项，缺字段时抛错且不落库', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    let thrown: unknown;
    try {
      await service.saveConfig('oss', { region: 'oss-cn-hangzhou' }, 'admin-1');
    } catch (e) {
      thrown = e;
    }
    restore();

    expect(thrown).toBeInstanceOf(Error);
    expect(prisma.rows.size).toBe(0);
  });

  it('字段定义覆盖连接位置 / 读取出口 / 凭据 / 高级四组', () => {
    const groups = new Set(STORAGE_CONFIG_FIELDS.oss.map((f) => f.group));
    for (const group of ['连接位置', '读取出口', '服务端凭据', '高级']) {
      expect(groups.has(group)).toBe(true);
    }
    // 新增的可编辑项：路径前缀、公开域名、签名有效期、STS
    for (const name of ['pathPrefix', 'publicBaseUrl', 'urlExpiresSeconds', 'sessionToken']) {
      expect(STORAGE_CONFIG_FIELDS.oss.some((f) => f.name === name)).toBe(true);
    }
    // 本地后端也带公开访问地址配置
    expect(STORAGE_CONFIG_FIELDS.local.map((f) => f.name)).toEqual(['publicBaseUrl']);
  });

  it('保存时拒绝带路径的 Endpoint 与非法端口', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);

    await expect(
      service.saveConfig('oss', { ...OSS_VALUES, endpoint: 'https://oss.example.com/bucket' }, 'admin-1'),
    ).rejects.toThrow(/服务根地址/);
    await expect(
      service.saveConfig('minio', {
        endPoint: 'minio.local',
        port: '70000',
        accessKey: 'a',
        secretKey: 'b',
      }, 'admin-1'),
    ).rejects.toThrow(/端口/);
    restore();
    expect(prisma.rows.size).toBe(0);
  });

  it('路径前缀归一：去首尾斜杠、空值回落默认 huojue', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();

    const view = await service.saveConfig('oss', { ...OSS_VALUES, pathPrefix: ' /canvas/ ' }, 'admin-1');
    expect(view.values.pathPrefix).toBe('canvas');
    restore();
  });

  it('云端新上传 key 带配置前缀，本地不带', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();

    // 本地默认不加前缀（/uploads 的目录结构是部署契约）
    expect(service.buildKey('original', 'png').startsWith('original/')).toBe(true);

    await service.saveConfig('oss', { ...OSS_VALUES, pathPrefix: ' /canvas/ ' }, 'admin-1');
    /*
     * 本机没装 ali-oss 时 provider 不会注册，但配置值已进内存。
     * 这里直接注入占位 provider 并切默认后端，验证 key 前缀逻辑，
     * 不依赖真实 SDK。
     */
    const internals = service as unknown as {
      providers: Map<string, unknown>;
      active: string;
    };
    internals.providers.set('oss', { backend: 'oss' });
    internals.active = 'oss';
    expect(service.buildKey('original', 'png').startsWith('canvas/original/')).toBe(true);
    restore();
  });

  it('saveConfig 记录审计信息并下发 updatedAt', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();

    const view = await service.saveConfig('oss', OSS_VALUES, 'admin-9');
    expect(view.updatedBy).toBe('admin-9');
    expect(view.updatedAt).toBeTruthy();
    restore();
  });

  it('testDraft 只读配置不落库，缺 SDK 时返回诊断而不是抛错', async () => {
    const prisma = fakePrisma();
    const { service, restore } = makeService(prisma);
    await service.onModuleInit();

    const res = await service.testDraft('oss', { ...OSS_VALUES, pathPrefix: 'draft' });

    // 本机通常没装 ali-oss：应得到 ok=false 的诊断结论
    expect(typeof res.ok).toBe('boolean');
    expect(prisma.rows.size).toBe(0);
    expect(service.configView('oss').source).toBe('none');
    restore();
  });
});
