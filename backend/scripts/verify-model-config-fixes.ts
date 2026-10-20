/**
 * 模型配置页 · effective 三态的回归防护 (2026-10-20 重设计)。
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
 * `effective` 的三态判定 —— 它有明确的独立预期值, 且能通过红验证:
 *   - 改前: 视频/文本未接入时返回 'local' (谎报有本地兜底)
 *   - 改后: 返回 'none' (如实表示「无兜底, 会失败」)
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
  // ── 1. effective 三态: 全部通道未配置时的判定 ──────────────────────
  {
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
    const out = await makeService([]).readAll();

    for (const r of out.routes) {
      if (r.modality === 'image') {
        ok(`${r.capability} (image) 未接入 → local (有本地算法)`, r.effective === 'local', r.effective);
      } else {
        /*
         * ⚠️ 本页最关键的一条: 文本/视频**不得**报 local。
         * 报了就是在后台谎报「会回落本地」, 而实际调用直接失败。
         * (与「不把本地伪装成模型」是同一类错误的反向版本)
         */
        ok(
          `${r.capability} (${r.modality}) 未接入不得报 local`,
          r.effective !== 'local',
          r.effective,
        );
        ok(`${r.capability} (${r.modality}) 未接入 → none`, r.effective === 'none', r.effective);
      }
    }

    for (const [mod, ch] of Object.entries(out.channels)) {
      ok(
        `${mod} 通道 effective 取值合法`,
        ['gateway', 'local', 'none'].includes(ch.effective),
        ch.effective,
      );
      if (mod !== 'image') {
        ok(`${mod} 通道未接入不得报 local`, ch.effective !== 'local', ch.effective);
      }
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

  // ── 4. 三态判定有实际意义的前提 ───────────────────────────────────
  {
    const byModality = new Map<string, number>();
    for (const c of CAPABILITIES) byModality.set(c.modality, (byModality.get(c.modality) ?? 0) + 1);
    ok(
      '存在非图像模态能力 (否则 none 态永无用武之地)',
      (byModality.get('text') ?? 0) + (byModality.get('video') ?? 0) > 0,
      Object.fromEntries(byModality),
    );
    // 「只有 image 有兜底」是三态判定成立的**独立证据**
    ok(
      '所有图像能力都有本地实现',
      CAPABILITIES.filter((c) => c.modality === 'image' && !c.localImpl).length === 0,
    );
    ok(
      '非图像能力都没有本地实现',
      CAPABILITIES.filter((c) => c.modality !== 'image' && c.localImpl).length === 0,
    );
  }

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('模型配置 effective 三态断言通过（无兜底不谎报 local · 已配置判 gateway）');
}

void main();