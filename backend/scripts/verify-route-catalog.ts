/**
 * 能力选路验收（原 `verify:route-catalog` 的新口径）。
 *
 * 前台模型层删除后，选路只看「能力 → 绑定 → 渠道模型」。本脚本用纯内存
 * 快照驱动 `RouterService` / `RouteHealthService` / `weightedRoute`，覆盖：
 *
 *   · 用户选中的模型分组优先，跨分组只在该分组失败后兜底；
 *   · 24h 健康分层把低成功率线路下沉；
 *   · 冷却中的线路被剔除；
 *   · 同层加权随机分布；
 *   · `simulate` 与 `resolve` 的结果一致。
 *
 * 不连库、不启 Nest：接线错误由后端集成测试与真实 HTTP 手工验证覆盖。
 * 运行：`NODE_ENV=development npm run verify:route-catalog`
 */

import { RouterService, weightedRoute } from '../src/model/routing/router.service';
import { RouteHealthService } from '../src/model/routing/route-health.service';
import type { CapabilitySpec } from '../src/model/intent/spec-types';
import type {
  CachedCapability,
  CachedCapabilityBinding,
  CachedCapabilityPricing,
  CachedChannelModel,
  CapabilityCatalogSnapshot,
} from '../src/model/routing/routing.types';

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

/* ────────────────────────── 夹具 ────────────────────────── */

function imageSpec(): CapabilitySpec {
  return {
    version: 1,
    capability: 'image',
    operations: ['text_to_image', 'image_to_image'],
    inputs: { image: { min: 0, max: 4 } },
    options: {},
  };
}

function pricing(unit = 10_000_000): CachedCapabilityPricing {
  return {
    capabilityId: 'free_create',
    billingMode: 'fixed_request',
    unitPriceMicrocredits: unit,
    inputTokenPriceMicrocredits: 0,
    outputTokenPriceMicrocredits: 0,
    cachedTokenPriceMicrocredits: 0,
    configured: true,
  };
}

function channelModel(
  id: string,
  groupKey: string,
  channelId = `ch-${id}`,
  extra: Partial<CachedChannelModel> = {},
): CachedChannelModel {
  return {
    id,
    channelId,
    channelName: channelId,
    modelKey: id,
    modelGroupKey: groupKey,
    providerModelKey: id,
    displayName: id,
    icon: '',
    sortOrder: 0,
    enabled: true,
    channelEnabled: true,
    capability: 'image',
    protocol: 'openai-image',
    priceCurrency: 'credits',
    billingMode: 'fixed_request',
    priceConfigured: true,
    priceVersion: 1,
    priceTiers: [],
    capabilitySpec: imageSpec(),
    ...extra,
  };
}

function binding(
  model: CachedChannelModel,
  priority = 0,
  weight = 100,
  enabled = true,
): CachedCapabilityBinding {
  return {
    id: `bind-${model.id}`,
    capabilityId: 'free_create',
    channelModelId: model.id,
    enabled,
    priority,
    weight,
    channelModel: model,
  };
}

function snapshot(bindings: CachedCapabilityBinding[]): CapabilityCatalogSnapshot {
  const groups = new Map<string, { modelKey: string; displayName: string; icon: string; lines: CachedCapabilityBinding[] }>();
  const channelModels = new Map<string, CachedChannelModel>();
  for (const item of bindings) {
    const key = item.channelModel.modelGroupKey || item.channelModel.modelKey;
    const group = groups.get(key) ?? { modelKey: key, displayName: key, icon: '', lines: [] };
    group.lines.push(item);
    groups.set(key, group);
    channelModels.set(item.channelModelId, item.channelModel);
  }
  const capability: CachedCapability = {
    id: 'free_create',
    pricing: pricing(),
    groups: groups as never,
    orderedGroupKeys: [...groups.keys()],
  };
  return {
    capabilities: new Map([['free_create', capability]]),
    channelModels,
    loadedAt: Date.now(),
    catalogVersion: 1,
  };
}

function routerFor(snap: CapabilityCatalogSnapshot, tiers = new Map<string, 0 | 1 | 2>()) {
  const catalog = {
    snapshotOrThrow: async () => snap,
    findCapability: async (id: string) => snap.capabilities.get(id) ?? null,
    findChannelModel: async (id: string) => snap.channelModels.get(id) ?? null,
  };
  const scores = { tiers: async () => tiers };
  const health = new RouteHealthService();
  return { router: new RouterService(catalog as never, health, scores as never), health };
}

const intent = {
  capability: 'image',
  operation: 'text_to_image',
  inputs: { image: 0 },
  options: {},
};

/* ────────────────────────── 断言 ────────────────────────── */

(async () => {
  console.log('【分组优先】');
  {
    const snap = snapshot([
      binding(channelModel('a1', 'group-a')),
      binding(channelModel('b1', 'group-b')),
    ]);
    const { router } = routerFor(snap);
    const picked = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const routed = await router.resolve(null, 'free_create', 'group-b', intent);
      picked.add(routed.modelKey);
    }
    eq('选中 group-b 时只从 group-b 取线路', [...picked], ['group-b']);
  }

  console.log('\n【跨分组兜底】');
  {
    const snap = snapshot([
      binding(channelModel('a1', 'group-a')),
      binding(channelModel('b1', 'group-b')),
    ]);
    const { router } = routerFor(snap);
    const routed = await router.resolve(null, 'free_create', 'group-b', intent, new Set(['b1']));
    eq('选中分组全部失败后回落到其它分组', routed.modelKey, 'group-a');
  }

  console.log('\n【健康分层】');
  {
    const snap = snapshot([
      binding(channelModel('sick', 'group-a')),
      binding(channelModel('healthy', 'group-a')),
    ]);
    const tiers = new Map<string, 0 | 1 | 2>([
      ['sick', 2],
      ['healthy', 0],
    ]);
    const { router } = routerFor(snap, tiers);
    const picked = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const routed = await router.resolve(null, 'free_create', 'group-a', intent);
      picked.add(routed.channelModel.id);
    }
    eq('低健康线路下沉，不会被选中', [...picked], ['healthy']);
  }

  console.log('\n【手工优先级只在同健康层内生效】');
  {
    const snap = snapshot([
      binding(channelModel('preferred', 'group-a'), -5),
      binding(channelModel('sick-preferred', 'group-a'), -50),
    ]);
    const tiers = new Map<string, 0 | 1 | 2>([
      ['preferred', 0],
      ['sick-preferred', 2],
    ]);
    const { router } = routerFor(snap, tiers);
    const picked = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const routed = await router.resolve(null, 'free_create', 'group-a', intent);
      picked.add(routed.channelModel.id);
    }
    eq('健康分层压过手工优先级', [...picked], ['preferred']);
  }

  console.log('\n【冷却剔除】');
  {
    const snap = snapshot([
      binding(channelModel('cooling', 'group-a')),
      binding(channelModel('warm', 'group-a')),
    ]);
    const { router, health } = routerFor(snap);
    health.block('channel-model:cooling', 60_000);
    const picked = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const routed = await router.resolve(null, 'free_create', 'group-a', intent);
      picked.add(routed.channelModel.id);
    }
    eq('冷却中的线路不参与选路', [...picked], ['warm']);
  }

  console.log('\n【同层加权随机】');
  {
    const one = weightedRoute([{ weight: 1 }, { weight: 3 }]);
    ok('weightedRoute 返回其中一项', one !== undefined);
    const counts = { a: 0, b: 0 };
    const lines = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 3 },
    ];
    for (let i = 0; i < 4000; i += 1) {
      const picked = weightedRoute(lines);
      counts[picked.id as 'a' | 'b'] += 1;
    }
    const ratio = counts.b / 4000;
    ok('1:3 权重的实际占比接近 75%', ratio > 0.7 && ratio < 0.8, ratio);
  }

  console.log('\n【模拟与解析同源】');
  {
    const snap = snapshot([
      binding(channelModel('only', 'group-a')),
      binding(channelModel('other', 'group-b')),
    ]);
    const { router } = routerFor(snap);
    const simulated = await router.simulate(null, 'free_create', intent, 'group-a');
    const routed = await router.resolve(null, 'free_create', 'group-a', intent);
    eq('simulate 选中线路与 resolve 一致', simulated.selectedChannelModelId, routed.channelModel.id);
    eq('simulate 命中选中分组', simulated.selectedModelKey, 'group-a');
  }

  console.log('\n【禁用绑定】');
  {
    const snap = snapshot([
      binding(channelModel('disabled', 'group-a'), 0, 100, false),
      binding(channelModel('enabled', 'group-a')),
    ]);
    const { router } = routerFor(snap);
    const picked = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const routed = await router.resolve(null, 'free_create', 'group-a', intent);
      picked.add(routed.channelModel.id);
    }
    eq('停用的绑定不参与选路', [...picked], ['enabled']);
  }

  console.log(`\n${'='.repeat(54)}`);
  console.log(`  通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length > 0) {
    console.log('  失败项：');
    for (const failure of fails) console.log(`  - ${failure}`);
  }
  console.log('='.repeat(54));
  process.exit(fails.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error('[验证] 异常:', error);
  process.exit(1);
});
