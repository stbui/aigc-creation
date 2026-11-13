import { ADMIN_EMAIL, ADMIN_PASSWORD } from './admin-credentials';

/**
 * 渠道与能力绑定 E2E 的最小可运行目录夹具。
 *
 * 不直接改数据库：所有数据都走管理员 HTTP API 创建，确保测试覆盖权限守卫、
 * DTO 校验、事务写入和目录失效。上游固定指向 `test/` 的仿真网关，后端仅对
 * 127.0.0.1 放行，不能把这个夹具当成任意私网访问的逃生口。
 *
 * 前台模型层删除后，夹具改为「建商品 → 绑定能力 → 设能力售价」。
 */

const API = process.env.E2E_API ?? 'http://localhost:4100';
const CHANNEL_PREFIX = '验收渠道-E2E-';
const CAPABILITIES = ['free_create', 'main_image'] as const;

type JsonRecord = Record<string, any>;

export interface CapabilityPricingSnapshot {
  capabilityId: string;
  billingMode: string;
  unitPriceMicrocredits: number;
  inputTokenPriceMicrocredits: number;
  outputTokenPriceMicrocredits: number;
  cachedTokenPriceMicrocredits: number;
}

export interface ModelSuiteFixture {
  channelId: string;
  channelName: string;
  secondaryChannelId: string;
  secondaryChannelName: string;
  channelModelId: string;
  channelModelKey: string;
  /** C 端模型分组键（当前夹具中与 channelModelKey 相同） */
  modelKey: string;
  /** 夹具改动前的能力售价，teardown 时恢复 */
  pricingBackup: CapabilityPricingSnapshot[];
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

async function bindingsOf(token: string, capabilityId: string): Promise<JsonRecord[]> {
  const data = await call('GET', `/admin/capabilities/${capabilityId}/models`, token);
  return (data.bindings ?? []) as JsonRecord[];
}

/** 从能力候选池里摘掉某个渠道的全部商品 */
async function unbindChannelModels(
  token: string,
  capabilityId: string,
  channelNamePrefix: string,
): Promise<void> {
  const bindings = await bindingsOf(token, capabilityId);
  const kept = bindings
    .filter((row) => !String(row.channelName ?? '').startsWith(channelNamePrefix))
    .map((row) => ({
      channelModelId: String(row.channelModelId),
      enabled: Boolean(row.enabled),
      priority: Number(row.priority) || 0,
      weight: Number(row.weight) || 100,
    }));
  await call('PUT', `/admin/capabilities/${capabilityId}/models`, token, { bindings: kept });
}

/** 清掉上一轮异常中断留下的同名夹具；正常 afterAll 也会走同一套删除路径。 */
async function removeStaleFixtureData(token: string): Promise<void> {
  const channels = await call('GET', '/admin/channels?limit=100', token);
  for (const channel of (channels.channels ?? []) as JsonRecord[]) {
    if (!String(channel.name ?? '').startsWith(CHANNEL_PREFIX)) continue;
    for (const capabilityId of CAPABILITIES) {
      await unbindChannelModels(token, capabilityId, CHANNEL_PREFIX).catch(() => undefined);
    }
    await call('DELETE', `/admin/channels/${channel.id}`, token).catch(() => undefined);
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

async function pricingOf(token: string, capabilityId: string): Promise<CapabilityPricingSnapshot> {
  const data = await call('GET', `/admin/capabilities/${capabilityId}/pricing`, token);
  return {
    capabilityId,
    billingMode: String(data.billingMode ?? 'fixed_request'),
    unitPriceMicrocredits: Number(data.unitPriceMicrocredits) || 0,
    inputTokenPriceMicrocredits: Number(data.inputTokenPriceMicrocredits) || 0,
    outputTokenPriceMicrocredits: Number(data.outputTokenPriceMicrocredits) || 0,
    cachedTokenPriceMicrocredits: Number(data.cachedTokenPriceMicrocredits) || 0,
  };
}

async function setPricing(
  token: string,
  capabilityId: string,
  pricing: CapabilityPricingSnapshot,
): Promise<void> {
  await call('PUT', `/admin/capabilities/${capabilityId}/pricing`, token, {
    billingMode: pricing.billingMode,
    unitPriceMicrocredits: pricing.unitPriceMicrocredits,
    inputTokenPriceMicrocredits: pricing.inputTokenPriceMicrocredits,
    outputTokenPriceMicrocredits: pricing.outputTokenPriceMicrocredits,
    cachedTokenPriceMicrocredits: pricing.cachedTokenPriceMicrocredits,
  });
}

export async function createModelSuiteFixture(): Promise<ModelSuiteFixture> {
  const token = await login();
  await removeStaleFixtureData(token);

  const stamp = Date.now().toString(36);
  const channelName = `${CHANNEL_PREFIX}${stamp}`;
  const secondaryChannelName = `${CHANNEL_PREFIX}${stamp}-B`;
  const channelModelKey = `e2e-fixture-image-${stamp}`;
  let channelId = '';
  let secondaryChannelId = '';
  let channelModelId = '';
  const pricingBackup: CapabilityPricingSnapshot[] = [];

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
    channelModelId = String(channelModel.id ?? '');
    if (!channelModelId) throw new Error('创建渠道模型成功但响应缺少 id');

    await call('POST', `/admin/channel-models/${channelModelId}/publish`, token, {
      capabilities: [...CAPABILITIES],
    });

    // 能力售价是全局配置：记录旧值，teardown 恢复，避免污染其它用例/本地环境
    for (const capabilityId of CAPABILITIES) {
      pricingBackup.push(await pricingOf(token, capabilityId));
      await setPricing(token, capabilityId, {
        capabilityId,
        billingMode: 'fixed_request',
        unitPriceMicrocredits: 2_000_000,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
      });
    }

    return {
      channelId,
      channelName,
      secondaryChannelId,
      secondaryChannelName,
      channelModelId,
      channelModelKey,
      modelKey: channelModelKey,
      pricingBackup,
    };
  } catch (error) {
    for (const pricing of pricingBackup) {
      await setPricing(token, pricing.capabilityId, pricing).catch(() => undefined);
    }
    if (channelModelId) {
      for (const capabilityId of CAPABILITIES) {
        await unbindChannelModels(token, capabilityId, channelName).catch(() => undefined);
      }
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
    for (const capabilityId of CAPABILITIES) {
      await unbindChannelModels(token, capabilityId, fixture.channelName).catch(() => undefined);
    }
    for (const pricing of fixture.pricingBackup) {
      await setPricing(token, pricing.capabilityId, pricing).catch(() => undefined);
    }
    await call('DELETE', `/admin/channels/${fixture.channelId}`, token).catch(() => undefined);
    await call('DELETE', `/admin/channels/${fixture.secondaryChannelId}`, token).catch(() => undefined);
  }
  await removeStaleFixtureData(token);
}
