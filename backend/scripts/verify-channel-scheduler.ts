/**
 * 多渠道调度断言 (2026-10-20)。
 *
 * ## 覆盖什么
 *
 * 多渠道是本项目**第一个真正多渠道**的调度机制, 语义都是新的:
 *   - 顺序调度 (priority 小者先试)
 *   - 失败换下一家 (而不是直接回落本地 / 直接失败)
 *   - 熔断 (连续失败 N 次进冷却, 冷却期内跳过)
 *   - 恢复 (成功后清零计数并退出冷却)
 *   - 全部失败的不可用原因 (与"试了但失败"区分)
 *
 * 这些**类型系统完全看不出来**, 且错的后果是静默的 (挂了不切、不该切的切了),
 * 故用桩 Prisma 逐条钉住。
 *
 * ⚠️ 与既有约定一致: 断言必须能**红**。写完要故意破坏被修行为验证一次,
 * 见文件末尾的说明。
 */

import { ChannelScheduler, type Channel } from '../src/providers/channel-scheduler';
import { ChannelRepository } from '../src/providers/channel-repository';

let pass = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => {
  if (c) pass += 1;
  else fails.push(`${n}${d !== undefined ? ` — ${JSON.stringify(d)}` : ''}`);
};

// ── 桩 Prisma: 内存表 ─────────────────────────────────────────────
class FakePrisma {
  rows: any[] = [];
  modelChannel = {
    findMany: async (args: any) => {
      const out = this.rows.filter((r) => r.modality === args?.where?.modality);
      return [...out].sort((a, b) => a.priority - b.priority);
    },
    findFirst: async (args: any) => {
      const out = this.rows.filter((r) => r.modality === args?.where?.modality);
      return out.length ? [...out].sort((a, b) => b.priority - a.priority)[0] : null;
    },
    // ⚠️ 要尊重 select: move() 只取 {modality}, 若这里返回整行,
    // 桩测的就不是真实 Prisma 的行为 (真实库按 select 裁剪字段)。
    // 返回整行在多数场景无害, 但会掩盖「代码依赖了未被 select 的字段」这类问题。
    findUnique: async (args: any) => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (!row) return null;
      if (args.select) {
        const out: any = {};
        for (const k of Object.keys(args.select)) if (args.select[k]) out[k] = row[k];
        return out;
      }
      return row;
    },
    count: async (args: any) =>
      this.rows.filter((r) => r.modality === args?.where?.modality).length,
    create: async (args: any) => {
      const row = {
        id: `ch${this.rows.length + 1}`,
        failCount: 0,
        cooldownUntil: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        ...args.data,
      };
      this.rows.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error('not found');
      /*
       * 真实表上有 `@@unique([modality, priority])`，SQLite 逐语句立即检查、
       * 事务不能推迟。桩必须照抄这条约束，否则「两条 update 直接互换 priority」
       * 这种必然 P2002 的写法在闸口里永远是绿的 —— 2026-10-21 线上即因此漏网。
       */
      const next = args.data?.priority;
      if (next !== undefined) {
        const clash = this.rows.find(
          (r) => r.id !== row.id && r.modality === row.modality && r.priority === next,
        );
        if (clash) {
          throw Object.assign(
            new Error('Unique constraint failed on the fields: (`modality`, `priority`)'),
            { code: 'P2002' },
          );
        }
      }
      Object.assign(row, args.data);
      return row;
    },
    delete: async (args: any) => {
      this.rows = this.rows.filter((r) => r.id !== args.where.id);
    },
  };

  /**
   * ⚠️ `$transaction` 是 **Prisma client 级**方法, 不在 `modelChannel` 委托里。
   * 放错位置会让 `this.prisma.$transaction is not a function` ——
   * 而真实 Prisma 上它确实是顶层方法, 故桩必须照真实形状造。
   *
   * 真实签名是 `$transaction(promises[])` —— 参数是**已创建的 promise**,
   * 不是函数。桩这里按同样契约 await 它们。
   */
  $transaction = async (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
    // 真实 Prisma 两种形态都支持：数组（批量）与回调（交互式事务）。
    // 桩必须同时支持，否则 createWithMaterialize 这类交互式事务会被误测成「不支持」。
    if (typeof arg === 'function') return arg(this);
    for (const p of arg) await p;
  };
}

function makeScheduler(rows: any[] = []) {
  const prisma = new FakePrisma();
  prisma.rows = rows;
  return { scheduler: new ChannelScheduler(prisma as never), prisma };
}

/** 造一条通道行 */
function ch(over: Partial<any> = {}): any {
  return {
    id: 'c1',
    modality: 'image',
    name: '通道A',
    protocol: 'openai',
    baseUrl: 'https://a.example.com',
    token: 'k',
    model: 'm',
    priority: 0,
    enabled: true,
    failCount: 0,
    cooldownUntil: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    ...over,
  };
}

async function main() {
  // ── 1. 顺序调度: priority 小者先试 ────────────────────────────────
  {
    const { scheduler } = makeScheduler([
      ch({ id: 'a', priority: 1, name: '第二' }),
      ch({ id: 'b', priority: 0, name: '第一' }),
    ]);
    const order: string[] = [];
    const r = await scheduler.dispatch('image', async (c) => {
      order.push(c.name);
      return `走${c.name}`;
    });
    ok('按 priority 升序尝试', order[0] === '第一', order);
    ok('首条成功即返回', r.ok === true && r.value === '走第一', r);
    ok('只尝试了一条 (成功即停)', order.length === 1, order);
    ok('回报走通的通道', r.channel?.id === 'b', r.channel);
  }

  // ── 2. 失败换下一家 ─────────────────────────────────────────────
  {
    const { scheduler } = makeScheduler([
      ch({ id: 'a', priority: 0, name: '挂了' }),
      ch({ id: 'b', priority: 1, name: '备用' }),
    ]);
    const order: string[] = [];
    const r = await scheduler.dispatch('image', async (c) => {
      order.push(c.name);
      if (c.name === '挂了') throw new Error('HTTP 429 限流');
      return 'ok';
    });
    ok('第一条失败后试第二条', order.length === 2, order);
    ok('最终成功', r.ok === true, r);
    ok('回报的是走通的那条', r.channel?.id === 'b', r.channel);
    ok('失败尝试也记录在案', r.attempts.length === 2, r.attempts.length);
    ok('失败原因被记下', r.attempts[0].reason?.includes('429'), r.attempts[0]);
    ok('成功尝试无 reason', r.attempts[1].reason === undefined, r.attempts[1]);
  }

  // ── 3. 全部失败 → 明确失败, 且给出不可用原因 ─────────────────────
  {
    const { scheduler } = makeScheduler([
      ch({ id: 'a', priority: 0, name: 'A' }),
      ch({ id: 'b', priority: 1, name: 'B' }),
    ]);
    const r = await scheduler.dispatch('image', async () => {
      throw new Error('boom');
    });
    ok('全部失败则 ok=false', r.ok === false, r.ok);
    ok('没有产出', r.value === undefined, r.value);
    ok('没有 channel', r.channel === undefined, r.channel);
    ok('给出不可用原因', typeof r.unavailableReason === 'string' && r.unavailableReason.length > 0, r.unavailableReason);
    ok('两条尝试都记录了', r.attempts.length === 2, r.attempts.length);
  }

  // ── 4. 熔断: 连续失败进冷却, 冷却期内跳过 ───────────────────────
  {
    // 首条已连续失败 2 次 (阈值 3), 再失败一次即进冷却
    const { scheduler, prisma } = makeScheduler([ch({ id: 'a', failCount: 2 })]);
    await scheduler.dispatch('image', async () => {
      throw new Error('fail');
    });
    const after = prisma.rows[0];
    ok('累计失败数 +1', after.failCount === 3, after.failCount);
    ok('达阈值后进入冷却', after.cooldownUntil instanceof Date, after.cooldownUntil);
    ok('记录了失败时间', after.lastFailureAt instanceof Date, after.lastFailureAt);

    // 下一次调度: 该通道在冷却中 → 应被跳过而不是再试
    const order: string[] = [];
    const { scheduler: s2 } = makeScheduler([
      ch({ id: 'a', priority: 0, name: '冷却中', failCount: 3, cooldownUntil: new Date(Date.now() + 60_000) }),
      ch({ id: 'b', priority: 1, name: '可用' }),
    ]);
    const r2 = await s2.dispatch('image', async (c) => {
      order.push(c.name);
      return 'ok';
    });
    ok('冷却中的通道被跳过', !order.includes('冷却中'), order);
    ok('跳到下一条并成功', r2.ok === true && r2.channel?.id === 'b', r2);
    ok('跳过也记录在案', r2.attempts.some((a) => a.reason?.includes('冷却')), r2.attempts);
  }

  // ── 5. 恢复: 冷却已过期的通道会被重新尝试 ───────────────────────
  {
    /*
     * ⚠️ 用例写的是「冷却**已过期**」—— 冷却中的通道本来就该被跳过 (见用例 4),
     * 这里要验的是相反方向: cooldownUntil 已过去时, 通道重新参与调度。
     * 最初写成 +60_000 (仍在冷却), 于是断言与实现互相矛盾, 是我自己的测试 bug。
     */
    const { scheduler, prisma } = makeScheduler([
      ch({ id: 'a', failCount: 5, cooldownUntil: new Date(Date.now() - 1000) }),
    ]);
    const r = await scheduler.dispatch('image', async () => 'ok');
    ok('冷却已过期的通道会重新被尝试', r.ok === true, r);
    const after = prisma.rows[0];
    ok('成功后清零失败计数', after.failCount === 0, after.failCount);
    ok('成功后退出冷却', after.cooldownUntil === null, after.cooldownUntil);
    ok('记录成功时间', after.lastSuccessAt instanceof Date, after.lastSuccessAt);
  }

  // ── 6. 一条都没配 → 不可用, 而非"试了失败" ──────────────────────
  {
    const { scheduler } = makeScheduler([]);
    // 合成通道要求 gatewayConfigOf('image').enabled —— 测试环境未配置,
    // 故 readChannels 返回空。这正是"未配置"分支。
    const r = await scheduler.dispatch('image', async () => 'never');
    ok('无通道时不调用 run', r.ok === false && r.attempts.length === 0, r);
    ok('说明是"未配置任何通道"', (r.unavailableReason ?? '').includes('未配置'), r.unavailableReason);
  }

  // ── 7. 合成通道 (存量单通道) 的惰性迁移 ─────────────────────────
  {
    /*
     * 表里没有行时, 调度器应能用存量单通道配置合成一条 ——
     * 这样存量部署零配置获得多渠道能力, 而不是一上线就全部失败。
     */
    const { scheduler, prisma } = makeScheduler([]);
    // 注入单通道配置让合成生效
    const { setGatewayConfigOverrides, invalidateGatewayConfigCache } = await import(
      '../src/providers/gateway.config'
    );
    setGatewayConfigOverrides({
      'gateway.image.baseUrl': 'https://api.siliconflow.cn',
      'gateway.image.token': 'sk-test',
      'gateway.image.enabled': 'true',
      'gateway.image.provider': 'openai',
      'gateway.image.model': 'qwen-image',
    });
    invalidateGatewayConfigCache();

    const r = await scheduler.dispatch('image', async (c) => `走${c.name}`);
    ok('无表行时用存量配置合成通道', r.ok === true, r);
    ok('合成通道的协议来自存量配置', r.channel?.protocol === 'openai', r.channel);
    ok('合成通道不落库 (表仍为空)', prisma.rows.length === 0, prisma.rows.length);

    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 8. 合成通道的健康更新被安全跳过 ─────────────────────────────
  {
    /*
     * 合成通道没有 DB id (synthetic:xxx), markSuccess/markFailure 必须跳过,
     * 否则会拿 `synthetic:image` 去 update → Prisma 抛 not found。
     * 而这个异常若没被吞, 会让一次成功的生成整体失败。
     */
    const { setGatewayConfigOverrides, invalidateGatewayConfigCache } = await import(
      '../src/providers/gateway.config'
    );
    setGatewayConfigOverrides({
      'gateway.image.baseUrl': 'https://api.siliconflow.cn',
      'gateway.image.token': 'sk-test',
      'gateway.image.enabled': 'true',
      'gateway.image.provider': 'openai',
    });
    invalidateGatewayConfigCache();
    const { scheduler } = makeScheduler([]);
    const r = await scheduler.dispatch('image', async () => 'ok');
    ok('合成通道成功不因健康更新而崩', r.ok === true, r);
    const r2 = await scheduler.dispatch('image', async () => {
      throw new Error('fail');
    });
    ok('合成通道失败也不因健康更新而崩', r2.ok === false, r2);
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 9. ChannelRepository: 首次新增会固化合成通道 ─────────────────
  {
    const { setGatewayConfigOverrides, invalidateGatewayConfigCache } = await import(
      '../src/providers/gateway.config'
    );
    setGatewayConfigOverrides({
      'gateway.image.baseUrl': 'https://api.siliconflow.cn',
      'gateway.image.token': 'sk-test',
      'gateway.image.enabled': 'true',
      'gateway.image.provider': 'openai',
      'gateway.image.model': 'qwen-image',
    });
    invalidateGatewayConfigCache();

    const prisma = new FakePrisma();
    const repo = new ChannelRepository(prisma as never);

    const list0 = await repo.list('image');
    ok('空表时列出合成通道', list0.length === 1 && list0[0].synthetic === true, list0);
    // 'sk-test' 只有 7 字符 (≤8), maskToken 按约定全遮 —— 期望值要按真实长度算,
    // 不能想当然写 startsWith('sk-t') (那是我拍脑袋的预期, 不是实现的行为)
    ok('合成通道的凭据已脱敏', list0[0].tokenMasked === '*******', list0[0].tokenMasked);

    await repo.create('image', { name: '优云智算·备用', protocol: 'openai', priority: 1 });
    ok('新增后合成通道被固化', prisma.rows.length === 2, prisma.rows.length);
    ok('固化的通道 priority=0', prisma.rows[0].priority === 0, prisma.rows[0]);
    ok('新通道 priority=1', prisma.rows[1].priority === 1, prisma.rows[1]);

    const list1 = await repo.list('image');
    ok('固化后不再标记为 synthetic', list1.every((c) => !c.synthetic), list1.map((c) => c.synthetic));

    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 10. token 留空 = 保持原值 ────────────────────────────────────
  {
    const prisma = new FakePrisma();
    prisma.rows = [ch({ id: 'x', token: 'sk-secret-1234' })];
    const repo = new ChannelRepository(prisma as never);
    const v = await repo.update('x', { name: '改了名字' });
    ok('改名字不影响 token', prisma.rows[0].token === 'sk-secret-1234', prisma.rows[0].token);
    // 'sk-secret-1234' 是 14 字符: 首 4 (sk-s) + 中 6 星 + 末 4 (1234)
    // ⚠️ 预期值要按**实际字符数**算, 不能拍脑袋 —— 我先后写错 7 星和 5 星,
    // 两次都是"我以为的长度"而不是"真实的长度"
    ok('回显里 token 仍脱敏', v.tokenMasked === 'sk-s******1234', v.tokenMasked);

    // 显式传空串也应保持原值 (空串 = 未填)
    await repo.update('x', { token: '' });
    ok('传空串不清除 token', prisma.rows[0].token === 'sk-secret-1234', prisma.rows[0].token);

    // 传非空才更新
    await repo.update('x', { token: 'sk-new-9999' });
    ok('传非空才更新 token', prisma.rows[0].token === 'sk-new-9999', prisma.rows[0].token);
  }

  // ── 11. 上下移: priority 交换 ────────────────────────────────────
  {
    const prisma = new FakePrisma();
    prisma.rows = [ch({ id: 'a', priority: 0, name: 'A' }), ch({ id: 'b', priority: 1, name: 'B' })];
    const repo = new ChannelRepository(prisma as never);
    const moved = await repo.move('b', 'up');
    // ⚠️ 断言要看**按 priority 排序后**的顺序, 不是数组下标 ——
    // update 是就地改 priority, 数组物理顺序不变 (a 仍在 [0], 只是它的 priority 变成 1)。
    // 最初断言 `rows[0].id === 'b'` 测的是数组下标, 那永远不成立, 是我的断言写错了。
    ok(
      '上移后按 priority 排序 b 在前',
      moved.map((c) => c.id).join(',') === 'b,a',
      moved.map((c) => c.id),
    );
    ok(
      'priority 仍唯一且连续',
      prisma.rows.map((r) => r.priority).sort().join(',') === '0,1',
      prisma.rows.map((r) => r.priority),
    );

    let threw = false;
    try {
      await repo.move('b', 'up');
    } catch {
      threw = true;
    }
    ok('已在最前时上移报错', threw);
  }

  // ── 12. 停用线路不参与调度 ───────────────────────────────────────
  {
    const { scheduler } = makeScheduler([
      ch({ id: 'off', priority: 0, name: '停用', enabled: false }),
      ch({ id: 'on', priority: 1, name: '启用', enabled: true }),
    ]);
    const tried: string[] = [];
    const r = await scheduler.dispatch('image', async (c) => {
      tried.push(c.name);
      return 'ok';
    });
    ok('停用线路被跳过', tried.join(',') === '启用', tried);
    ok('启用线路成功返回', r.ok === true && r.channel?.id === 'on', r.channel);
  }

  // ── 13. 全部停用不得回落到旧版合成通道 ───────────────────────────
  {
    const { setGatewayConfigOverrides, invalidateGatewayConfigCache } = await import(
      '../src/providers/gateway.config'
    );
    // 旧配置是启用的 —— 如果实现先去 where 过滤 enabled, 就会误判「表空」并合成旧配置
    setGatewayConfigOverrides({
      'gateway.image.baseUrl': 'https://api.siliconflow.cn',
      'gateway.image.token': 'sk-test',
      'gateway.image.enabled': 'true',
    });
    invalidateGatewayConfigCache();

    const { scheduler } = makeScheduler([ch({ id: 'off', enabled: false, name: '停用' })]);
    let called = false;
    const r = await scheduler.dispatch('image', async () => {
      called = true;
      return '不该走到这里';
    });
    ok('全部停用时不尝试任何线路', called === false);
    ok('全部停用时明确失败', r.ok === false, r);
    ok('不可用原因说明全部停用', String(r.unavailableReason ?? '').includes('均已停用'), r.unavailableReason);
    ok('全部停用不合成旧版配置', (r.attempts ?? []).length === 0, r.attempts);

    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
  }

  // ── 14. 未配置且无线路 → 原因区分「未配置」 ─────────────────────
  {
    const { setGatewayConfigOverrides, invalidateGatewayConfigCache } = await import(
      '../src/providers/gateway.config'
    );
    setGatewayConfigOverrides({});
    invalidateGatewayConfigCache();
    const { scheduler } = makeScheduler([]);
    const r = await scheduler.dispatch('text', async () => 'ok');
    ok('未配置时明确失败', r.ok === false, r);
    ok('原因说明未配置而非全部失败', String(r.unavailableReason ?? '').includes('未配置'), r.unavailableReason);
  }

  // ── 15. snapshot: 可用数/冷却数/协议未接入 ───────────────────────
  {
    const prisma = new FakePrisma();
    prisma.rows = [
      ch({ id: 'a', enabled: true, failCount: 0, protocol: 'openai' }),
      ch({ id: 'b', priority: 1, enabled: false }),
      ch({ id: 'c', priority: 2, enabled: true, cooldownUntil: new Date(Date.now() + 60_000) }),
      ch({ id: 'd', priority: 3, enabled: true, protocol: 'not-a-protocol' }),
    ];
    const repo = new ChannelRepository(prisma as never);
    const snap = await repo.snapshot('image');
    ok('snapshot 来源为 channels', snap.source === 'channels', snap.source);
    ok('snapshot 总数正确', snap.total === 4, snap.total);
    ok('availableCount 只数启用+未冷却+协议已实现', snap.availableCount === 1, snap.availableCount);
    ok('coolingCount 正确', snap.coolingCount === 1, snap.coolingCount);
    ok('unsupportedCount 正确', snap.unsupportedCount === 1, snap.unsupportedCount);
  }

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('多渠道调度断言通过（顺序调度 · 失败转移 · 熔断 · 恢复 · 惰性迁移 · 凭据不回显）');
}

void main();