/**
 * 前台模型与选路验收（P3）。
 *
 * 验收台词（`docs/channel-model-design.md` §10）：priority 分层、加权、SKU 选择、
 * 冷却必须有单测覆盖，且**模拟接口结果与单测一致**。这里把两件事放在同一份
 * 脚本里：
 *
 *   A. 纯逻辑断言（不连库）—— `RouterService.eligibleRoutes` / `weightedRoute` /
 *      `PriceTierService.tierForIntent` / `RouteHealthService` / `CatalogService`
 *      投影，全部用手工构造的快照驱动；
 *   B. HTTP 接线断言 —— 在进程内启 Nest 打自己的端口，确认 `/models*` 与
 *      `/admin/logical-models/:id/simulate` 真的挂在预期路径上、经过守卫与信封。
 *
 * 为什么不只做函数直调：路由前缀、全局守卫、响应信封、DTO 白名单这四样
 * 只在真实 HTTP 往返里才会暴露接线错误，而函数直调永远通过。
 *
 * 运行：NODE_ENV=development npm run verify:route-catalog
 * 纯逻辑部分：VERIFY_HTTP=0 NODE_ENV=development npm run verify:route-catalog
 */
process.env.PORT = process.env.PORT || '3014';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

import { weightedRoute } from '../src/model/routing/router.service';
import { RouteHealthService, cooldownForFailure } from '../src/model/routing/route-health.service';
import type {
  CachedChannelModel,
  CachedLogicalModel,
  CachedLogicalRoute,
  CachedPriceTier,
  RouteCatalogSnapshot,
} from '../src/model/routing/routing.types';
import type { CapabilitySpec } from '../src/model/intent/spec-types';
import { UserGroupAccess, type ResolvedGroup } from '../src/model/user-groups/user-group.service';

const { RouterService } = require('../src/model/routing/router.service');
const { PriceTierService } = require('../src/model/routing/price-tier.service');
const { CatalogService } = require('../src/model/catalog/catalog.service');

let pass = 0;
const fails: string[] = [];
const ok = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    pass += 1;
    return;
  }
  fails.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
};
const eq = (name: string, actual: unknown, expected: unknown) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

/* ────────────────────────── 测试夹具 ────────────────────────── */

function tier(
  id: string,
  selector: Record<string, string>,
  unit: number,
  extra: Partial<CachedPriceTier> = {},
): CachedPriceTier {
  return {
    id,
    selector,
    selectorJson: JSON.stringify(selector),
    resolution: '*',
    videoSeconds: 0,
    providerModelKey: '',
    billingMode: 'fixed_request',
    unitPriceMicrocredits: unit,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    priceConfigured: true,
    enabled: true,
    priceVersion: 0,
    ...extra,
  };
}

function imageSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    version: 1,
    capability: 'image',
    inputs: { image: { min: 0, max: 4 } },
    options: {
      size: { values: ['1024x1024', '2048x1152', '4096x4096'] },
      quality: { values: ['1k', '1.5k', '2k'] },
    },
    ...overrides,
  };
}

function channelModel(input: {
  id: string;
  channelId: string;
  modelKey?: string;
  spec?: CapabilitySpec;
  tiers?: CachedPriceTier[];
  currency?: string;
}): CachedChannelModel {
  const tiers = input.tiers ?? [];
  return {
    id: input.id,
    channelId: input.channelId,
    modelKey: input.modelKey ?? input.id,
    providerModelKey: input.modelKey ?? input.id,
    displayName: input.modelKey ?? input.id,
    capability: 'image',
    protocol: 'openai',
    priceCurrency: input.currency ?? 'credits',
    billingMode: 'fixed_request',
    priceConfigured: tiers.some((item) => item.enabled && item.priceConfigured),
    priceVersion: 0,
    capabilitySpec: input.spec ?? imageSpec(),
    priceTiers: tiers,
  };
}

function route(
  id: string,
  priority: number,
  weight: number,
  channel: CachedChannelModel,
  enabled = true,
): CachedLogicalRoute {
  return { id, channelModelId: channel.id, enabled, priority, weight, channelModel: channel };
}

function logicalModel(input: {
  id?: string;
  routes: CachedLogicalRoute[];
  pricePolicy?: string;
  productSpec?: CapabilitySpec;
  billingMode?: string;
}): CachedLogicalModel {
  return {
    id: input.id ?? 'lm-1',
    code: 'lm-code',
    name: '验收模型',
    icon: '',
    description: '',
    capability: 'image',
    sortOrder: 0,
    enabled: true,
    pricePolicy: input.pricePolicy ?? 'channel',
    billingMode: input.billingMode ?? 'fixed_request',
    unitPriceMicrocredits: 0,
    inputPriceMicrocredits: 0,
    outputPriceMicrocredits: 0,
    cachedPriceMicrocredits: 0,
    legacyModelIds: [],
    revisionId: 'rev-1',
    revisionVersion: 1,
    productSpec: input.productSpec ?? imageSpec(),
    defaults: {},
    routes: input.routes,
    archivedAt: null,
  };
}

function accessOf(options: {
  ratio?: number;
  channels?: string[];
  allChannels?: boolean;
  pointsPerUsd?: bigint;
} = {}): UserGroupAccess {
  const group: ResolvedGroup = {
    id: 'group-1',
    code: 'verify',
    name: '验收分组',
    badgeLabel: '',
    badgeStyle: '',
    ratioBasisPoints: options.ratio ?? 10_000,
    pointsPerUsd: options.pointsPerUsd ?? 7_000_000n,
    pointsPerCny: 1_000_000n,
    allChannels: options.allChannels ?? true,
    channels: new Set(options.channels ?? []),
    overrides: new Map(),
  };
  return new UserGroupAccess(group);
}

function fakeCatalog(model: CachedLogicalModel) {
  const snapshot: RouteCatalogSnapshot = {
    models: new Map([[model.id, model]]),
    ordered: [model.id],
    loadedAt: Date.now(),
    catalogVersion: 1,
  };
  return { snapshotOrThrow: async () => snapshot, snapshotNow: async () => snapshot };
}

/* ────────────────────────── A. 纯逻辑断言 ────────────────────────── */

export async function runPureChecks(): Promise<void> {
  const health = new RouteHealthService();
  const priceTiers = new PriceTierService();

  /* A1. priority 硬分层：高优先级只要有一条可用，低优先级不参与分流 */
  {
    const c1 = channelModel({ id: 'cm-1', channelId: 'ch-1', tiers: [tier('t-wild', {}, 10)] });
    const c2 = channelModel({ id: 'cm-2', channelId: 'ch-2', tiers: [tier('t-wild-2', {}, 10)] });
    const c3 = channelModel({ id: 'cm-3', channelId: 'ch-3', tiers: [tier('t-wild-3', {}, 10)] });
    const routes = [route('r-high-1', 10, 1, c1), route('r-high-2', 10, 2, c2), route('r-low', 5, 100, c3)];
    const router = new RouterService(fakeCatalog(logicalModel({ routes })), health, priceTiers);
    const access = accessOf();
    const intent = { capability: 'image', inputs: {}, options: { size: '1024x1024' } };

    eq(
      '同层线路全部进入候选池',
      router.eligibleRoutes(access, routes, intent, new Set(), true).map((item) => item.id).sort(),
      ['r-high-1', 'r-high-2'],
    );

    health.recordFailure('upstream_401', { channelId: 'ch-1', channelModelId: 'cm-1', routeId: 'r-high-1' });
    eq(
      '401 冷却渠道后同层剩余线路继续承接',
      router.eligibleRoutes(access, routes, intent, new Set(), true).map((item) => item.id),
      ['r-high-2'],
    );

    health.recordFailure('upstream_404', { channelId: 'ch-2', channelModelId: 'cm-2', routeId: 'r-high-2' });
    eq(
      '高层全部不可用时才下沉到低优先级',
      router.eligibleRoutes(access, routes, intent, new Set(), true).map((item) => item.id),
      ['r-low'],
    );
    health.clear();
  }

  /* A2. 同层加权随机：权重是容量策略，分布偏差必须可测 */
  {
    const routes = [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }];
    const rounds = 20_000;
    let first = 0;
    for (let index = 0; index < rounds; index += 1) {
      if (weightedRoute(routes).id === 'a') first += 1;
    }
    const share = first / rounds;
    ok('加权随机比例接近 1:3（0.25 ± 0.03）', share > 0.22 && share < 0.28, { share });
    eq('单线路直接返回自身', weightedRoute([{ id: 'only', weight: 7 }]).id, 'only');
    eq('全零权重退化为首条', weightedRoute([{ id: 'x', weight: 0 }, { id: 'y', weight: 0 }]).id, 'x');
  }

  /* A3. SKU 选择：精确优先、通配兜底、1.5K 相邻档、停用档忽略 */
  {
    const cm = channelModel({
      id: 'cm-sku',
      channelId: 'ch-sku',
      tiers: [
        tier('t-1k', { operation: 'text_to_image', quality: '1k' }, 10),
        tier('t-wild', { operation: 'text_to_image' }, 5),
        tier('t-2k', { operation: 'text_to_image', quality: '2k' }, 20),
      ],
    });
    const exact = priceTiers.tierForIntent(cm, { capability: 'image', inputs: {}, options: { size: '1024x1024' } });
    eq('尺寸推断 1K 命中精确档', exact?.id, 't-1k');

    const wildOnly = channelModel({
      id: 'cm-wild',
      channelId: 'ch-wild',
      tiers: [tier('t-wild-only', { operation: 'text_to_image' }, 5)],
    });
    eq(
      '无精确档时命中通配档',
      priceTiers.tierForIntent(wildOnly, { capability: 'image', inputs: {}, options: { size: '4096x4096' } })?.id,
      't-wild-only',
    );

    const adjacent = channelModel({
      id: 'cm-adj',
      channelId: 'ch-adj',
      tiers: [tier('t-2k-only', { operation: 'text_to_image', quality: '2k' }, 20)],
    });
    eq(
      '1.5K 请求按相邻档命中 2K',
      priceTiers.tierForIntent(adjacent, { capability: 'image', inputs: {}, options: { size: '2048x1152' } })?.id,
      't-2k-only',
    );

    const both = channelModel({
      id: 'cm-both',
      channelId: 'ch-both',
      tiers: [
        tier('t-15k', { operation: 'text_to_image', quality: '1.5k' }, 15),
        tier('t-1k-2', { operation: 'text_to_image', quality: '1k' }, 10),
      ],
    });
    eq(
      '精确 1.5K 档优先于相邻 1K 档',
      priceTiers.tierForIntent(both, { capability: 'image', inputs: {}, options: { size: '2048x1152' } })?.id,
      't-15k',
    );

    const disabled = channelModel({
      id: 'cm-disabled',
      channelId: 'ch-disabled',
      tiers: [tier('t-disabled', { operation: 'text_to_image', quality: '1k' }, 10, { enabled: false })],
    });
    eq(
      '停用档不参与匹配',
      priceTiers.tierForIntent(disabled, { capability: 'image', inputs: {}, options: { size: '1024x1024' } }),
      null,
    );
  }

  /* A4. 冷却：只有可归因失败才冷却，且冷却范围与失败含义匹配 */
  {
    const target = { channelId: 'ch-a', channelModelId: 'cm-a', routeId: 'r-a' };
    const unauthorized = cooldownForFailure('upstream_401', target);
    eq('401 冷却整条渠道 10 分钟', unauthorized, { key: 'channel:ch-a', durationMs: 600_000 });
    eq('403 与 401 同口径', cooldownForFailure('upstream_403', target), {
      key: 'channel:ch-a',
      durationMs: 600_000,
    });
    eq('404 只冷却该渠道模型', cooldownForFailure('upstream_404', target), {
      key: 'channel-model:cm-a',
      durationMs: 600_000,
    });
    eq('429 默认 30 秒', cooldownForFailure('upstream_429', target), { key: 'channel:ch-a', durationMs: 30_000 });
    eq('429 优先采用 Retry-After', cooldownForFailure('upstream_429', target, 5_000), {
      key: 'channel:ch-a',
      durationMs: 5_000,
    });
    eq('超时不冷却', cooldownForFailure('timeout', target), null);
    eq('5xx 不冷却', cooldownForFailure('upstream_500', target), null);

    const service = new RouteHealthService();
    service.recordFailure('upstream_404', target, undefined, 1_000);
    ok('404 后该模型被冷却', service.isBlocked(target, 1_001));
    ok(
      '404 不连坐同渠道其它模型',
      !service.isBlocked({ ...target, channelModelId: 'cm-other', routeId: 'r-other' }, 1_001),
    );
    service.clear();

    service.recordFailure('upstream_429', target, 1_000, 5_000);
    ok('429 在 Retry-After 内冷却', service.isBlocked(target, 5_500));
    ok('429 到期自动解封', !service.isBlocked(target, 6_100));
    eq('冷却键可枚举（后台排查用）', service.snapshot(1_000).length, 0);
  }

  /* A5. 模拟与选路同源：simulate 选中的线路必须等于 resolve 实际走的线路 */
  {
    const cA = channelModel({
      id: 'cm-a',
      channelId: 'ch-a',
      tiers: [tier('t-a-1k', { operation: 'text_to_image', quality: '1k' }, 10)],
    });
    const cB = channelModel({
      id: 'cm-b',
      channelId: 'ch-b',
      tiers: [tier('t-b-2k', { operation: 'text_to_image', quality: '2k' }, 20)],
    });
    const cC = channelModel({
      id: 'cm-c',
      channelId: 'ch-c',
      tiers: [tier('t-c-wild', { operation: 'text_to_image' }, 5)],
    });
    const model = logicalModel({
      routes: [route('r-a', 10, 1, cA), route('r-b', 10, 1, cB), route('r-c', 5, 10, cC)],
    });
    const catalog = fakeCatalog(model);
    const router = new RouterService(catalog, health, priceTiers);
    const access = accessOf();
    const intent = { capability: 'image' as const, inputs: {}, options: { size: '1024x1024' } };

    const routed = await router.resolve(access, model.id, intent);
    const simulated = await router.simulate(access, model.id, intent);
    eq('resolve 选中 1K 档线路', routed.route.id, 'r-a');
    eq('simulate 与 resolve 选中同一条线路', simulated.selectedRouteId, routed.route.id);
    eq('simulate 与 resolve 选中同一价格档', simulated.selectedPriceTierId, routed.priceTier?.id);
    const missing = simulated.routes.find((item) => item.routeId === 'r-b');
    ok('模拟摊开价格档缺失原因', missing?.priceTierMissing === true, missing);
    const lower = simulated.routes.find((item) => item.routeId === 'r-c');
    ok('模拟标记低优先级线路未级联', lower?.eligible === false && lower?.selectedTier === false, lower);

    const rejected = await router.simulate(access, model.id, {
      capability: 'video',
      inputs: {},
      options: {},
    });
    ok('模拟对能力不匹配给出可读原因', rejected.productMatch.matched === false && rejected.reason !== '', rejected);
    eq('能力不匹配时不选中任何线路', rejected.selectedRouteId, '');

    let threw = false;
    try {
      await router.resolve(access, model.id, { capability: 'video', inputs: {}, options: {} });
    } catch (error) {
      threw = true;
      ok('resolve 对能力不匹配抛出可读错误', String((error as Error).message ?? '').includes('不支持'), error);
    }
    ok('resolve 能力不匹配必须失败', threw);
  }

  /* A6. 目录投影：分组渠道可见性 + 货币换算与倍率顺序 */
  {
    const visible = channelModel({
      id: 'cm-visible',
      channelId: 'ch-visible',
      currency: 'USD',
      tiers: [tier('t-usd', { operation: 'text_to_image', quality: '1k' }, 1_000_000)],
    });
    const hidden = channelModel({
      id: 'cm-hidden',
      channelId: 'ch-hidden',
      tiers: [tier('t-hidden', {}, 10)],
    });
    const model = logicalModel({ routes: [route('r-visible', 10, 1, visible), route('r-hidden', 10, 1, hidden)] });
    const catalog = fakeCatalog(model);
    const router = new RouterService(catalog, health, priceTiers);
    const service = new CatalogService(catalog, router);

    const access = accessOf({ allChannels: false, channels: ['ch-visible'], ratio: 12_000, pointsPerUsd: 7_000_000n });
    const projected = service.projectForGroup(access, model);
    eq('分组不可见渠道被剔除', projected?.routes.map((item) => item.id), ['r-visible']);

    // 1 USD（价格档以百万分之一货币单位存储）× 7,000,000 微积分/USD ÷ 1e6 = 7,000,000 微积分；再乘分组 1.2 倍
    eq(
      '货币换算后再叠分组倍率（顺序不可反）',
      projected?.routes[0].channelModel.priceTiers[0].unitPriceMicrocredits,
      8_400_000,
    );

    const models = await service.publicModels(access);
    eq('公开目录按分组投影', models.map((item) => item.id), [model.id]);
    eq('公开目录价格档同步分组倍率', models[0].priceTiers[0].unitPriceMicrocredits, 8_400_000);
    ok('公开目录标记可用', models[0].available === true, models[0].available);

    const hiddenOnly = accessOf({ allChannels: false, channels: ['ch-other'] });
    eq('没有任何可见渠道时模型不下发', await service.publicModels(hiddenOnly), []);
  }
}

/* ────────────────────────── B. HTTP 接线断言 ────────────────────────── */

export async function runHttpChecks(): Promise<void> {
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('../src/app.module');
  const { ResponseInterceptor } = require('../src/common/response.interceptor');

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const base = `http://127.0.0.1:${address.port}/api/v1`;

  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: response.status, code: json.code, data: json.data, message: json.message ?? json.raw };
  };

  try {
    const anon = await call('GET', '/models', null);
    ok('匿名可读取模型目录', anon.code === 0 && Array.isArray(anon.data?.models), anon);
    ok(
      '目录不下发供应渠道字段',
      (anon.data?.models ?? []).every((item: any) => !('channelId' in item) && !('routes' in item)),
      anon.data?.models?.[0],
    );

    const badIntent = await call('POST', '/models/available', null, { capability: 'unknown' });
    eq('非法能力类型被拒绝', badIntent.code, 40001);

    const quoteUnknown = await call('POST', '/models/not-exists/quote', null, {
      capability: 'image',
      inputs: {},
      options: { size: '1024x1024' },
    });
    eq('未知模型报价返回业务错误而非 404', quoteUnknown.code, 40001);

    const available = await call('POST', '/models/available', null, {
      capability: 'image',
      inputs: {},
      options: { size: '1024x1024' },
    });
    ok('按意图筛选走通（未登录可用）', available.code === 0 && Array.isArray(available.data?.models), available);

    const denied = await call('POST', '/admin/logical-models/not-exists/simulate', null, { capability: 'image' });
    ok('模拟接口需要后台身份（未登录拒绝）', denied.status === 401 || denied.status === 403, denied);

    const login = await call('POST', '/auth/login', null, { email: 'admin@admin.com', password: '123456789' });
    ok('管理员登录', login.code === 0 && Boolean(login.data?.accessToken), login);
    const token: string = login.data?.accessToken;
    if (token) {
      const simulated = await call('POST', '/admin/logical-models/not-exists/simulate', token, {
        capability: 'image',
        inputs: {},
        options: { size: '1024x1024' },
      });
      eq('模拟接口对未知模型返回业务错误而非 404', simulated.code, 40001);

      /*
       * 命名空间回归：产品能力 id（`expand` / `main_image`）与模态
       * （`image` / `video`）是两套东西。页面很容易把产品能力 id 传上来，
       * 后端必须按模型自己的能力合同兜底，而不是报「缺少有效的模型能力类型」。
       */
      const models = (
        (await (await call('GET', '/admin/logical-models', token)).data ?? [])
      ) as Array<{ id: string; capability: string }>;
      const target = models.find((item) => Boolean(item?.id));
      if (target) {
        const withoutCapability = await call('POST', `/admin/logical-models/${target.id}/simulate`, token, {
          inputs: {},
          options: {},
        });
        ok('模拟：省略 capability 时按模型合同取模态', withoutCapability.code === 0, withoutCapability);

        const withProductId = await call('POST', `/admin/logical-models/${target.id}/simulate`, token, {
          capability: target.capability,
          inputs: {},
          options: {},
        });
        ok('模拟：传产品能力 id 也按省略处理（不报「缺少有效的模型能力类型」）', withProductId.code === 0, withProductId);
      }
    }
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  await runPureChecks();
  if (String(process.env.VERIFY_HTTP ?? '1') !== '0') {
    await runHttpChecks();
  }
  console.log(`\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项` : ''}`);
  for (const failure of fails) console.log(`  ✗ ${failure}`);
  if (fails.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
