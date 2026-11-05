import { ADMIN_EMAIL, ADMIN_PASSWORD } from './admin-credentials';

/**
 * 渠道与模型 E2E 的最小可运行目录夹具。
 *
 * 不直接改数据库：所有数据都走管理员 HTTP API 创建，确保测试覆盖权限守卫、
 * DTO 校验、事务写入和目录失效。上游固定指向 `test/` 的仿真网关，后端仅对
 * 127.0.0.1 放行，不能把这个夹具当成任意私网访问的逃生口。
 */

const API = process.env.E2E_API ?? 'http://localhost:4100';
const CHANNEL_PREFIX = '验收渠道-E2E-';
const LOGICAL_CODE_PREFIX = 'e2e-fixture-';

type JsonRecord = Record<string, any>;

export interface ModelSuiteFixture {
  channelId: string;
  channelName: string;
  secondaryChannelId: string;
  secondaryChannelName: string;
  channelModelId: string;
  channelModelKey: string;
  freeCreateId: string;
  freeCreateCode: string;
  mainImageId: string;
  mainImageCode: string;
}

class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} -> ${status}: ${body.slice(0, 800)}`);
  }
}

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<JsonRecord> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(method, path, res.status, text);
  let json: JsonRecord;
  try {
    json = JSON.parse(text) as JsonRecord;
  } catch {
    throw new ApiError(method, path, res.status, `响应不是 JSON: ${text}`);
  }
  if (json.code !== 0) throw new ApiError(method, path, res.status, text);
  return (json.data ?? {}) as JsonRecord;
}

async function login(): Promise<string> {
  const data = await call('POST', '/auth/login', null, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const token = String(data.accessToken ?? '');
  if (!token) throw new Error('管理员登录成功但响应缺少 accessToken');
  return token;
}

async function listLogicalModels(token: string): Promise<JsonRecord[]> {
  const data = await call('GET', '/admin/logical-models?includeArchived=1', token);
  return Array.isArray(data) ? data : ((data.models ?? []) as JsonRecord[]);
}

/** 清掉上一轮异常中断留下的同名夹具；正常 afterAll 也会走同一套删除路径。 */
async function removeStaleFixtureData(token: string): Promise<void> {
  const models = await listLogicalModels(token);
  for (const model of models) {
    if (!String(model.code ?? '').startsWith(LOGICAL_CODE_PREFIX) || model.archivedAt) continue;
    await call('DELETE', `/admin/logical-models/${model.id}`, token);
  }

  const channels = await call('GET', '/admin/channels?limit=100', token);
  for (const channel of (channels.channels ?? []) as JsonRecord[]) {
    if (!String(channel.name ?? '').startsWith(CHANNEL_PREFIX)) continue;
    await call('DELETE', `/admin/channels/${channel.id}`, token);
  }
}

function imageCapabilityConfig() {
  return {
    version: 1,
    image: {
      references: {
        promptMaxChars: 2000,
        maxImages: 1,
        maxImageBytes: 5_000_000,
        maskSupported: false,
      },
      size: {
        parameter: 'size',
        values: ['1024x1024'],
        default: '1024x1024',
        allowCustom: false,
      },
      resolution: { supported: true, values: ['1k', '2k'], default: '1k' },
      quality: { supported: false, values: [], default: 'auto' },
      transparentBackground: { supported: false, default: false },
      responseFormat: { supported: true, default: 'url' },
      outputFormat: { supported: false },
      maxOutputs: 1,
    },
  };
}

export async function createModelSuiteFixture(): Promise<ModelSuiteFixture> {
  const token = await login();
  await removeStaleFixtureData(token);

  const stamp = Date.now().toString(36);
  const channelName = `${CHANNEL_PREFIX}${stamp}`;
  const secondaryChannelName = `${CHANNEL_PREFIX}${stamp}-B`;
  const channelModelKey = `e2e-fixture-image-${stamp}`;
  const freeCreateCode = `${LOGICAL_CODE_PREFIX}free-create-${stamp}`;
  const mainImageCode = `${LOGICAL_CODE_PREFIX}main-image-${stamp}`;
  let channelId = '';
  let secondaryChannelId = '';
  const logicalModelIds: string[] = [];

  try {
    const channel = await call('POST', '/admin/channels', token, {
      name: channelName,
      baseUrl: 'http://127.0.0.1:3900',
      apiKey: 'mock-token',
      concurrencyLimit: 3,
    });
    channelId = String(channel.id ?? '');
    if (!channelId) throw new Error('创建渠道成功但响应缺少 id');

    // 排序与 CAS 用例至少需要两条渠道；额外渠道不带模型，不影响线路数断言。
    const secondaryChannel = await call('POST', '/admin/channels', token, {
      name: secondaryChannelName,
      baseUrl: 'http://127.0.0.1:3900',
      apiKey: 'mock-token',
      concurrencyLimit: 1,
    });
    secondaryChannelId = String(secondaryChannel.id ?? '');
    if (!secondaryChannelId) throw new Error('创建第二个渠道成功但响应缺少 id');

    const channelModel = await call('POST', `/admin/channels/${channelId}/models`, token, {
      modelKey: channelModelKey,
      providerModelKey: 'gpt-image-2',
      displayName: 'E2E 图片模型',
      capability: 'image',
      protocol: 'openai-image',
      channelLabel: 'E2E 仿真线路',
      capabilityConfig: imageCapabilityConfig(),
      priceTiers: [
        {
          selector: {},
          providerModelKey: 'gpt-image-2',
          billingMode: 'fixed_request',
          unitPriceMicrocredits: 2_000_000,
          priceConfigured: true,
          enabled: true,
          costPricing: { configured: true, unitPriceMicrocredits: 1_200_000 },
        },
      ],
    });
    const channelModelId = String(channelModel.id ?? '');
    if (!channelModelId) throw new Error('创建渠道模型成功但响应缺少 id');

    const common = {
      enabled: true,
      sortOrder: 0,
      pricePolicy: 'channel',
      defaultOptions: {},
      routes: [{ channelModelId, enabled: true, priority: 0, weight: 100 }],
    };
    const freeCreate = await call('POST', '/admin/logical-models', token, {
      ...common,
      code: freeCreateCode,
      name: 'E2E 自由创作',
      description: '渠道与模型 E2E 夹具',
      capability: 'free_create',
      capabilitySpec: {
        version: 1,
        capability: 'image',
        operations: ['text_to_image'],
        inputs: {},
        options: {},
      },
    });
    const freeCreateId = String(freeCreate.id ?? '');
    if (!freeCreateId) throw new Error('创建 free_create 前台模型成功但响应缺少 id');
    logicalModelIds.push(freeCreateId);

    const mainImage = await call('POST', '/admin/logical-models', token, {
      ...common,
      code: mainImageCode,
      name: 'E2E 商品主图',
      description: '渠道与模型 E2E 夹具',
      capability: 'main_image',
      capabilitySpec: {
        version: 1,
        capability: 'image',
        operations: ['text_to_image', 'image_to_image'],
        inputs: { image: { min: 1, max: 1 } },
        options: {},
      },
    });
    const mainImageId = String(mainImage.id ?? '');
    if (!mainImageId) throw new Error('创建 main_image 前台模型成功但响应缺少 id');
    logicalModelIds.push(mainImageId);

    return {
      channelId,
      channelName,
      secondaryChannelId,
      secondaryChannelName,
      channelModelId,
      channelModelKey,
      freeCreateId,
      freeCreateCode,
      mainImageId,
      mainImageCode,
    };
  } catch (error) {
    for (const id of logicalModelIds.reverse()) {
      await call('DELETE', `/admin/logical-models/${id}`, token).catch(() => undefined);
    }
    if (secondaryChannelId) await call('DELETE', `/admin/channels/${secondaryChannelId}`, token).catch(() => undefined);
    if (channelId) await call('DELETE', `/admin/channels/${channelId}`, token).catch(() => undefined);
    throw error;
  }
}

export async function removeModelSuiteFixture(
  fixture: ModelSuiteFixture | null,
): Promise<void> {
  const token = await login();
  if (fixture) {
    for (const id of [fixture.mainImageId, fixture.freeCreateId]) {
      await call('DELETE', `/admin/logical-models/${id}`, token).catch(() => undefined);
    }
    await call('DELETE', `/admin/channels/${fixture.channelId}`, token).catch(() => undefined);
    await call('DELETE', `/admin/channels/${fixture.secondaryChannelId}`, token).catch(() => undefined);
  }
  await removeStaleFixtureData(token);
}
