/**
 * 模型配置页 · effective 二态的回归防护 (2026-10-25 model-only 改造)。
 *
 * ## 起因: 一个被证伪的「缺陷」
 *
 * 重设计时我在路由总览里看到 `routes` 对全部能力都调 `imageCfg.routeOf(...)`,
 * 判定为「视频能力读了图像通道的配置」并改成了 `gatewayConfigOf(c.modality)`。
 *
 * **这个判断是错的**, 复核过程记录在案 (见 model-config.service 的同名注释):
 *   路由键是 `gateway.route.<能力 id>` (channel-config.defs 的 routeDefs),
 *   **不含模态前缀** —— 因为能力 id 全局唯一, 一项能力只产一种模态。
 *   三个通道的 routeOf 读的是**同一个键**, 故两种写法读出的值完全相同。
 *   也就是说: 那个「修复」没修任何东西, 只是让代码看起来更严谨。
 *
 * 更糟的是我第一版断言**没有发现这点** —— 它直接测 `gatewayConfigOf(modality).routeOf()`,
 * 也就是测「配置层读对了没有」, 而我怀疑的缺陷在「service 用错了配置对象」,
 * 两者之间隔着一层。把「缺陷」重新引入, 断言依然全绿。
 *
 * **可证伪性检查是断言有效性的前提**: 写完断言要**故意引入缺陷**跑一次,
 * 看它是否变红。不红的断言等于没写 —— 这条本项目已吃过亏 (正则批量改码、
 * 以及今天这次)。
 *
 * ## 本文件保留的断言: 真正可证伪的那一个
 *
 * `effective` 的判定 —— 它有明确的独立预期值, 且能通过红验证:
 *   - 未配置模型通道时返回 'none' (不谎报本地产出)
 *   - 配置后可用的能力返回 'gateway'
 *   - 存量 route=local 只能被展示为不可用, 且新写入 local 必须被拒绝
 */

import { CAPABILITIES } from '../src/capabilities/capability.registry';
import {
  gatewayConfigOf,
  setGatewayConfigOverrides,
  invalidateGatewayConfigCache,
} from '../src/providers/gateway.config';
import { ModelConfigService } from '../src/admin/model-config.service';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

/**
 * 真实 service + 桩 Prisma。
 *
 * ⚠️ 必须构造真 service 并调 readAll(): 直接测配置层会漏掉
 * 「service 用错对象」这一类缺陷 (上文那个被证伪的教训)。
 */
function makeService(rows: Array<{ key: string; value: string }>) {
  const prisma = {
    modelChannelConfig: {
      findMany: async () =>
        rows.map((r) => ({ ...r, overridden: true, updatedAt: null, updatedBy: null })),
    },
  } as never;
  const router = { invalidate: () => {} } as never;
  return new ModelConfigService(prisma, router);
}

async function main() {
  // ── 1. effective 二态: 全部通道未配置时的判定 ──────────────────────
  {
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
    const out = await makeService([]).readAll();

    for (const r of out.routes) {
      ok(
        `${r.capability} (${r.modality}) 未接入不得报本地可用`,
        r.effective !== 'local',
        r.effective,
      );
      ok(`${r.capability} (${r.modality}) 未接入 → none`, r.effective === 'none', r.effective);
      ok(`${r.capability} 不再暴露本地可用`, r.localAvailable === false, r.localAvailable);
    }

    for (const [mod, ch] of Object.entries(out.channels)) {
      ok(
        `${mod} 通道 effective 取值合法`,
        ['gateway', 'none'].includes(ch.effective),
        ch.effective,
      );
      ok(`${mod} 通道未接入 → none`, ch.effective === 'none', ch.effective);
    }
  }

  // ── 2. 已配置时应该是 gateway ─────────────────────────────────────
  {
    const rows = [
      { key: 'gateway.image.baseUrl', value: 'https://api.modelverse.cn' },
      { key: 'gateway.image.token', value: 'x' },
      { key: 'gateway.text.baseUrl', value: 'https://api.deepseek.com' },
      { key: 'gateway.text.token', value: 'x' },
      { key: 'gateway.video.baseUrl', value: 'https://api.minimax.io' },
      { key: 'gateway.video.token', value: 'x' },
    ];
    setGatewayConfigOverrides(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    invalidateGatewayConfigCache();
    const out = await makeService([]).readAll();

    for (const [mod, ch] of Object.entries(out.channels)) {
      ok(`${mod} 通道已配基址与令牌 → gateway`, ch.effective === 'gateway', ch.effective);
    }
    for (const r of out.routes) {
      ok(`${r.capability} 已配 → gateway`, r.effective === 'gateway', r.effective);
    }
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 3. 路由键不含模态 (钉住被证伪结论, 防后人重犯) ────────────────
  {
    /*
     * 这条不是「修好了什么」, 而是**钉住一个容易被重复误判的事实**:
     * `gateway.route.<能力 id>` 三模态共享, 故「按模态读路由」与
     * 「一律用图像通道读」完全等价 —— 今天已经在这里误判过一次。
     */
    setGatewayConfigOverrides({ 'gateway.route.image_to_video': 'remote' });
    invalidateGatewayConfigCache();
    const viaImage = gatewayConfigOf('image').routeOf('image_to_video');
    const viaVideo = gatewayConfigOf('video').routeOf('image_to_video');
    ok(
      '路由键三模态共享 (今天在此误判过, 钉住以防重犯)',
      viaImage === 'remote' && viaVideo === 'remote',
      { viaImage, viaVideo },
    );
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 4. model-only 能力模型的前提 ──────────────────────────────────
  {
    const byModality = new Map<string, number>();
    for (const c of CAPABILITIES) byModality.set(c.modality, (byModality.get(c.modality) ?? 0) + 1);
    ok(
      '存在非图像模态能力 (否则 none 态永无用武之地)',
      (byModality.get('text') ?? 0) + (byModality.get('video') ?? 0) > 0,
      Object.fromEntries(byModality),
    );
    ok(
      '所有能力都不再声明本地实现字段',
      CAPABILITIES.every(
        (c) => !Object.prototype.hasOwnProperty.call(c, 'localImpl') &&
          !Object.prototype.hasOwnProperty.call(c, 'localFallback'),
      ),
    );
  }

  // ── 5. 新写入不得再产生 route=local ───────────────────────────────
  {
    const writable = () => {
      const calls: string[] = [];
      const prisma = {
        modelChannelConfig: {
          findMany: async () => [] as Array<{ key: string; value: string }>,
          findUnique: async () => null,
          update: async () => ({}),
          create: async ({ data }: { data: { key: string; value: string } }) => {
            calls.push(`${data.key}=${data.value}`);
          },
          upsert: async () => ({}),
        },
      } as never;
      return { prisma, calls };
    };

    const target = CAPABILITIES[0];

    const bad = writable();
    const svcBad = new ModelConfigService(bad.prisma, { invalidate: () => {} } as never);
    let rejected = '';
    try {
      await svcBad.updateAll({ [`gateway.route.${target.id}`]: 'local' }, [], 'verify');
    } catch (e) {
      rejected = (e as { code?: number }).code === 40001 ? 'ok' : `wrong-code:${(e as { code?: number }).code}`;
    }
    ok(`所有能力都不能被写入 route=local (${target.id})`, rejected === 'ok', rejected);
    ok('被拒时不产生任何写入', bad.calls.length === 0, bad.calls);

    const good = writable();
    const svcGood = new ModelConfigService(good.prisma, { invalidate: () => {} } as never);
    await svcGood.updateAll(
      { [`gateway.route.${target.id}`]: 'remote', [`gateway.route.${CAPABILITIES[1].id}`]: 'auto' },
      [],
      'verify',
    );
    ok('auto / remote 正常写入', good.calls.length === 2, good.calls);

    // 存量 local 仍需可读、可诊断，但绝不能展示为可用。
    setGatewayConfigOverrides({ [`gateway.route.${target.id}`]: 'local' });
    invalidateGatewayConfigCache();
    const out = await makeService([]).readAll();
    const legacy = out.routes.find((r) => r.capability === target.id)!;
    ok('存量 route=local 保留可诊断', legacy.route === 'local', legacy.route);
    ok('存量 route=local 展示为不可用', legacy.effective === 'none', legacy.effective);
    ok('存量 localAvailable 恒为 false', legacy.localAvailable === false, legacy.localAvailable);
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  /*
   * ── 6. 全局设置里的 baseUrl 必须归一化到根域 (2026-10-23) ────────
   *
   * 线上实证: 运营照抄厂商文档填 `https://api.a6api.com/v1`, 协议层再补
   * `/v1/images/generations` → `/v1/v1/...` → 上游 404 api_route_not_found,
   * 而生成侧只看到「通道全部失败」。
   *
   * 断言打在**写入路径**上: 只测展示层等于「如实显示配错了」,
   * 写入时归一化才叫「不让它发生」。
   */
  {
    const writable = () => {
      const calls: string[] = [];
      const prisma = {
        modelChannelConfig: {
          findMany: async () => [] as Array<{ key: string; value: string }>,
          findUnique: async () => null,
          update: async () => ({}),
          create: async ({ data }: { data: { key: string; value: string } }) => {
            calls.push(`${data.key}=${data.value}`);
          },
          upsert: async () => ({}),
        },
      } as never;
      return { prisma, calls };
    };

    const cases: Array<[string, string]> = [
      ['https://api.a6api.com/v1', 'https://api.a6api.com'],
      ['https://api.a6api.com/v1/', 'https://api.a6api.com'],
      ['https://api.a6api.com/V1', 'https://api.a6api.com'],
      // 火山方舟的 /api/v3 是真实前缀, 不能被当成版本段剥掉
      ['https://ark.cn-beijing.volces.com/api/v3', 'https://ark.cn-beijing.volces.com/api/v3'],
      // 路径中段的 v1 可能是网关真实前缀, 不动
      ['https://gw.example.com/v1/gw', 'https://gw.example.com/v1/gw'],
      ['https://api.example.com', 'https://api.example.com'],
    ];
    for (const [input, expect] of cases) {
      const w = writable();
      const svc = new ModelConfigService(w.prisma, { invalidate: () => {} } as never);
      await svc.updateAll({ 'gateway.image.baseUrl': input }, [], 'verify');
      ok(
        `写入 gateway.image.baseUrl=${input} → ${expect}`,
        w.calls.length === 1 && w.calls[0] === `gateway.image.baseUrl=${expect}`,
        w.calls,
      );
    }

    // 归一化只治「多写一段」; 填错了仍然拒绝, 且不产生写入
    for (const bad of ['not-a-url', 'ftp://api.example.com']) {
      const w = writable();
      const svc = new ModelConfigService(w.prisma, { invalidate: () => {} } as never);
      let code = 0;
      try {
        await svc.updateAll({ 'gateway.image.baseUrl': bad }, [], 'verify');
      } catch (e) {
        code = (e as { code?: number }).code ?? -1;
      }
      ok(`非法基址 ${bad} 被拒 (40001)`, code === 40001, code);
      ok(`非法基址 ${bad} 不产生写入`, w.calls.length === 0, w.calls);
    }
  }

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('模型配置 model-only 断言通过（不谎报本地可用 · 新写入 local 被拒 · 已配置判 gateway）');
}

void main();
