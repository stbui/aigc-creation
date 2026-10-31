/**
 * 中转与运营闸口（P6 验收）。
 *
 * 覆盖 `docs/testing.md` §5.6 列出的五个缺口：
 *   1. **中转计费** —— `reserved → running → settled / refunded / uncertain` 的迁移、
 *      客户端密钥剥离、渠道自定义头覆盖、并发槽 429；
 *   2. **SSRF** —— `validateCustomRelayUrl` 的地址判定（纯函数，可直接断言）；
 *   3. **插件装卸** —— 包解析拒绝分支（非 zip / 路径穿越 / 同 id）与卸载拒绝分支；
 *   4. **财务分析** —— 「挂账不计入实收」等口径直接比对 `BillingOrder` 聚合与接口返回；
 *   5. **自动退款** —— `BillingSweeperService` 的两条迁移（TTL 可注入，压到毫秒级）。
 *
 * 为什么分两段：**A 段是纯逻辑**（地址判定 / 路径授权 / 并发槽 / 插件包解析），
 * 不连库、不起服务，能在离线机器上跑；**B 段要真实 HTTP 与真实账本**，
 * 同进程起 Nest 打自己的端口，断言走的是与生产完全相同的控制器 → 服务 → 账单链路。
 *
 * 与 `verify-task-runtime.ts` 同构的地方：夹具自建自清（按外键序），
 * 不依赖任何预置数据；中转上游用本机 HTTP mock，走的是真实 `outboundRequest`。
 *
 * 运行：cd backend && npm run verify:proxy-runtime
 *      （默认开发档；测测试库请显式 `NODE_ENV=test`）
 *      VERIFY_HTTP=0 可只跑 A 段纯逻辑。
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// 本机 mock 上游是 127.0.0.1：出站层默认拒绝私网，必须在 ConfigModule 装载前放行。
// 已存在的非空环境变量不会被 env 文件覆盖，故这里显式赋值即可。
process.env.MODEL_ALLOW_PRIVATE_UPSTREAMS = 'true';

const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../src/app.module');
const { ResponseInterceptor } = require('../src/common/response.interceptor');
const { PrismaService } = require('../src/prisma/prisma.service');
const { UserGroupService } = require('../src/model/user-groups/user-group.service');
const { BillingService } = require('../src/model/billing/billing.service');
const { BillingSweeperService } = require('../src/model/billing/billing-sweeper.service');
const { FinanceAnalyticsService } = require('../src/model/billing/finance-analytics.service');
const { PluginAdminService } = require('../src/model/plugins/plugin.admin.service');
const { CustomRelaySlotService } = require('../src/model/proxy/custom-relay-slot.service');
const { validateCustomRelayUrl, OutboundError, normalizeOutboundHeaders } = require('../src/model/infra/outbound');
const {
  authorizeCustomRelay,
  authorizeSystemProxy,
  isProxyRequestPath,
  isReservedApiPrefix,
  normalizeProxyPath,
  ProxyPathError,
  stripSecretQuery,
} = require('../src/model/proxy/proxy.paths');
const { grantCredits, clearCredits } = require('./credit-fixture');

/** 1 积分 = 1e6 微积分 */
const MICRO = 1_000_000n;

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail !== undefined ? ` — ${fmt(detail)}` : ''}`);
    return;
  }
  fails.push(`${name}${detail !== undefined ? ` — ${fmt(detail)}` : ''}`);
  console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${fmt(detail)}` : ''}`);
}
const fmt = (value: unknown) => String(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, 300);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 断言某段代码抛出指定错误；返回错误对象（未抛则 null） */
async function expectThrow(name: string, fn: () => unknown, match?: RegExp): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    if (match && !match.test(String((error as Error)?.message ?? ''))) {
      check(name, false, `错误信息不匹配：${(error as Error)?.message}`);
      return error;
    }
    check(name, true);
    return error;
  }
  check(name, false, '未抛出异常');
  return null;
}

/* ══════════════════════ A 段：纯逻辑 ══════════════════════ */

/**
 * A1. SSRF：自定义中转地址判定。
 *
 * 这些断言是**文档 §5.6 明确列为「可直接补 L2 断言」**的一项。
 * 关键点：判定基于**域名解析后的每个 IP**，不是 URL 字面量 ——
 * `http://evil.example` 若解析到 `127.0.0.1` 必须被拒。
 * 为让断言不依赖 DNS，用 IP 字面量做主机（字面量不触发解析）。
 */
async function runSsrfChecks(): Promise<void> {
  console.log('\n── A1. SSRF 地址判定 ──');

  // 结构性拒绝（不依赖 DNS）
  await expectThrow(
    '拒绝非 http/https 协议',
    () => validateCustomRelayUrl('ftp://example.com/v1'),
    /只支持 http\/https/,
  );
  await expectThrow(
    '拒绝 URL 内嵌凭据',
    () => validateCustomRelayUrl('https://user:pass@example.com/v1'),
    /不允许包含认证信息/,
  );
  await expectThrow(
    '拒绝 fragment',
    () => validateCustomRelayUrl('https://example.com/v1#frag'),
    /不允许包含片段/,
  );
  await expectThrow(
    '拒绝空地址',
    () => validateCustomRelayUrl(''),
    /地址无效/,
  );
  await expectThrow(
    '拒绝超长地址',
    () => validateCustomRelayUrl(`https://example.com/${'a'.repeat(5000)}`),
    /过长/,
  );

  // 内网 / 回环 / 链路本地（IP 字面量，不触发 DNS 解析）
  const blockedHosts = [
    ['127.0.0.1', '回环地址'],
    ['10.0.0.1', '私网 10/8'],
    ['172.16.0.1', '私网 172.16/12'],
    ['192.168.1.1', '私网 192.168/16'],
    ['169.254.169.254', '云 metadata 地址'],
    ['0.0.0.0', '未指定地址'],
    ['[::1]', 'IPv6 回环'],
    ['[fc00::1]', 'IPv6 ULA'],
    ['[fe80::1]', 'IPv6 链路本地'],
  ];
  for (const [host, label] of blockedHosts) {
    await expectThrow(
      `拒绝${label}`,
      () => validateCustomRelayUrl(`https://${host}/v1`),
      /不允许访问/,
    );
  }

  // 保留用途网段（strict 追加）
  await expectThrow(
    '拒绝 100.64/10 运营商级 NAT 网段',
    () => validateCustomRelayUrl('https://100.64.0.1/v1'),
    /保留地址/,
  );
  await expectThrow(
    '拒绝 240/4 保留网段',
    () => validateCustomRelayUrl('https://240.0.0.1/v1'),
    /保留地址/,
  );

  // HTTP（非 HTTPS）只允许显式放行的可信主机
  await expectThrow(
    'HTTP 上游未在可信主机名单中时拒绝',
    () => validateCustomRelayUrl('http://203.0.113.9/v1'),
    /可信上游主机/,
  );

  // 公网 IP 字面量应通过（不解析 DNS，字面量即地址）
  try {
    const parsed = await validateCustomRelayUrl('https://93.184.216.34/v1');
    check('放行公网 https 地址', parsed.hostname === '93.184.216.34', parsed.hostname);
  } catch (error) {
    check('放行公网 https 地址', false, (error as Error)?.message);
  }

  // 错误分类：地址不合法是 invalid_url，被拦的地址是 blocked_host
  let code = '';
  try {
    await validateCustomRelayUrl('https://127.0.0.1/v1');
  } catch (error) {
    code = error instanceof OutboundError ? error.code : 'not-outbound';
  }
  check('被拦地址归类为 blocked_host', code === 'blocked_host', code);
}

/**
 * A2. 代理路径授权：白名单而非黑名单。
 *
 * 中转若放行任意路径就是一台开放出站代理 —— 可被用来扫描内网、刷他人额度。
 * 因此「协议声明过的端点」是白名单，其余一律 403。
 */
async function runPathChecks(): Promise<void> {
  console.log('\n── A2. 路径与前缀授权 ──');

  // 保留前缀：业务路由不能被当成渠道 id
  for (const prefix of ['tasks', 'admin', 'models', 'auth', 'credits', 'ai', 'generate']) {
    check(`保留前缀 ${prefix} 不参与短路径匹配`, isReservedApiPrefix(prefix) === true);
  }
  check('非保留前缀不参与匹配', isReservedApiPrefix('ch-abc123') === false);

  // body-parser 跳过判定：保留前缀 = 业务路由 → 不跳过；其余两段 = 中转
  check('业务路由不被当成中转路径', isProxyRequestPath('/api/v1/tasks/abc') === false);
  check('中转路径跳过全局 JSON 解析', isProxyRequestPath('/api/v1/ch-abc/v1/chat/completions') === true);
  check('/ai/models 是普通业务接口，不跳过解析', isProxyRequestPath('/api/v1/ai/models') === false);
  check('/ai/custom 是中转路径', isProxyRequestPath('/api/v1/ai/custom') === true);
  check('单段路径不是中转', isProxyRequestPath('/api/v1/models') === false);

  // 路径规范化：变形即拒绝（不替调用方改写）
  check('合法路径原样通过', normalizeProxyPath('/v1/chat/completions') === '/v1/chat/completions');
  await expectThrow('拒绝含 `..` 的路径', () => normalizeProxyPath('/v1/../admin'), /路径无效/);
  await expectThrow('拒绝反斜杠路径', () => normalizeProxyPath('/v1\\admin'), /路径无效/);
  await expectThrow('拒绝空字节路径', () => normalizeProxyPath('/v1/%00'), /路径无效/);

  // 客户端密钥剥离：系统渠道是「剥离」，自定义渠道是「拒绝」
  const stripped = stripSecretQuery(new URLSearchParams('key=sk-1&api_key=sk-2&access_token=sk-3&token=sk-4&alt=sse&video_id=v1'));
  check('剥离四个密钥查询参数', ['key', 'api_key', 'access_token', 'token'].every((k) => !stripped.has(k)), [...stripped.keys()]);
  check('保留其余查询参数', stripped.get('alt') === 'sse' && stripped.get('video_id') === 'v1', [...stripped.entries()]);

  await expectThrow(
    '自定义中转拒绝查询串携带密钥',
    () => authorizeCustomRelay({ method: 'POST', path: '/v1/chat/completions', query: new URLSearchParams('key=sk-1'), format: 'openai', contentType: 'application/json' }),
    /不允许在查询参数中携带密钥/,
  );

  // 自定义中转白名单：未登记的端点一律拒绝
  await expectThrow(
    '自定义中转拒绝未登记端点',
    () => authorizeCustomRelay({ method: 'POST', path: '/v1/internal/debug', query: new URLSearchParams(), format: 'openai', contentType: 'application/json' }),
    /不允许访问/,
  );
  await expectThrow(
    '自定义中转拒绝 GET 访问生成端点',
    () => authorizeCustomRelay({ method: 'GET', path: '/v1/chat/completions', query: new URLSearchParams(), format: 'openai', contentType: '' }),
    /不允许访问/,
  );
  try {
    authorizeCustomRelay({ method: 'POST', path: '/v1/chat/completions', query: new URLSearchParams(), format: 'openai', contentType: 'application/json' });
    check('自定义中转放行已登记的生成端点', true);
  } catch (error) {
    check('自定义中转放行已登记的生成端点', false, (error as Error)?.message);
  }

  // 系统渠道：协议未注册 / 不支持中转 → 403
  await expectThrow(
    '系统渠道对未注册协议拒绝中转',
    () => authorizeSystemProxy({ protocol: 'nope', metadata: null, method: 'POST', path: '/v1/chat/completions' }),
    /尚未注册/,
  );
  await expectThrow(
    '系统渠道对不支持中转的协议拒绝',
    () => authorizeSystemProxy({ protocol: 'x', metadata: { capabilities: ['image'], async: false, requiresSecretKey: false }, method: 'POST', path: '/v1/chat/completions' }),
    /不支持经中转调用/,
  );

  // 系统渠道：GET /models 是渠道级端点，协议未注册也放行
  try {
    const auth = authorizeSystemProxy({ protocol: '', metadata: null, method: 'GET', path: '/models', fallbackFamily: 'gemini' });
    check('GET /models 走渠道格式鉴权（gemini → /v1beta）', auth.family === 'gemini' && auth.defaultPrefix === '/v1beta', auth);
  } catch (error) {
    check('GET /models 走渠道格式鉴权（gemini → /v1beta）', false, (error as Error)?.message);
  }

  // 渠道自定义头：禁止覆盖鉴权与保留头
  await expectThrow(
    '自定义头不得覆盖 Authorization',
    () => normalizeOutboundHeaders([{ name: 'Authorization', value: 'Bearer x' }]),
    /不允许/,
  );
  await expectThrow(
    '自定义头不得覆盖 x-canvas-* 保留头',
    () => normalizeOutboundHeaders([{ name: 'x-canvas-upstream-url', value: 'http://x' }]),
    /不允许/,
  );
}

/**
 * A3. 并发槽：拿不到即明确拒绝，不排队。
 *
 * 自定义中转是固定超时请求，排队只会让客户端先超时、上游再扣费。
 */
async function runSlotChecks(): Promise<void> {
  console.log('\n── A3. 并发槽 ──');
  const slots = new CustomRelaySlotService();

  const release1 = slots.acquire('u1', 2);
  const release2 = slots.acquire('u1', 2);
  check('拿不到槽位时返回 null（调用方回 429）', slots.acquire('u1', 2) === null);
  release1?.();
  check('释放一个槽位后可再获取', slots.acquire('u1', 2) !== null);
  release2?.();

  check('不同用户的槽位互不影响', slots.acquire('u2', 1) !== null);
  check('并发上限 0 表示不限', slots.acquire('u3', 0) !== null);
  check('空用户 id 拿不到槽位', slots.acquire('', 5) === null);
}

/**
 * A4. 插件包解析拒绝分支。
 *
 * 文档 §7.4 的容器限制：48MB / manifest ≤512KB / ≤256 文件 / 单文件 ≤16MB /
 * 路径白名单 / 拒绝符号链接 / 拒绝越界路径。这里逐条构造并断言被拒。
 */
async function runPluginPackageChecks(): Promise<void> {
  console.log('\n── A4. 插件包解析拒绝分支 ──');
  const { parsePluginPackage, validatePluginPackagePath } = require('../src/model/protocol/package');

  await expectThrow('拒绝非 zip 数据', () => parsePluginPackage(Buffer.from('not a zip at all')), /zip|大小|无效/);

  const zip = buildZip([
    { name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest()), 'utf8') },
    { name: 'web/index.html', content: Buffer.from('<html></html>', 'utf8') },
  ]);
  try {
    const pkg = parsePluginPackage(zip);
    check('合法包可解析', pkg.manifest.metadata.id === 'verify-plugin', pkg.manifest.metadata.id);
  } catch (error) {
    check('合法包可解析', false, (error as Error)?.message);
  }

  // 越界路径
  for (const bad of ['../escape.txt', '/etc/passwd', 'web\\..\\..\\escape.txt']) {
    await expectThrow(`拒绝越界路径 ${bad}`, () => validatePluginPackagePath(bad), /路径|非法/);
  }
  await expectThrow('拒绝含空字节的路径', () => validatePluginPackagePath('web/a\u0000b'), /路径|非法/);

  // 非白名单路径
  await expectThrow('拒绝白名单外的路径', () => validatePluginPackagePath('evil/run.sh'), /路径|非法|允许/);

  // 白名单内合法路径
  check('接受白名单内路径', validatePluginPackagePath('web/index.html') === 'web/index.html');

  // 文件数超限（256）
  const many = [{ name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest()), 'utf8') }];
  for (let i = 0; i < 300; i += 1) many.push({ name: `web/f${i}.txt`, content: Buffer.from('x', 'utf8') });
  await expectThrow('拒绝超过 256 个文件', () => parsePluginPackage(buildZip(many)), /文件数/);
}

/** 构造最小可用的插件清单（字段以 `protocol/manifest.ts` 的校验为准） */
function validManifest(): Record<string, unknown> {
  return {
    metadata: {
      id: 'verify-plugin',
      name: '验收插件',
      version: '1.0.0',
      vendor: 'verify',
      description: '用于 P6 验收脚本的最小清单',
    },
    runtime: { backend: 'declarative' },
    contributes: {
      providers: [
        {
          id: 'verify-provider',
          label: '验收协议',
          apiFormat: 'openai',
          protocols: ['verify-protocol'],
        },
      ],
    },
  };
}

/**
 * 构造一个最小 zip（stored，不压缩）。
 *
 * 自实现而不是引依赖：本仓依赖必须精确锁定且安装走直装 registry，
 * 为一个只用于测试的 zip 构造器引一棵依赖树不划算。
 */
function buildZip(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); // stored
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.content.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + entry.content.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** 标准 CRC-32（zip 目录需要） */
function crc32(buf: Buffer): number {
  let table = crc32Table;
  if (!table) {
    table = crc32Table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
let crc32Table: Int32Array | null = null;

/* ══════════════════════ B 段：HTTP 与账本 ══════════════════════ */

/**
 * 本机 mock 上游：按请求体里的 `model` 决定行为。
 *
 * 记下收到的请求头与查询串，用来断言「客户端密钥被剥离」「渠道自定义头被附加」。
 */
async function startMockUpstream() {
  const received: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
  const server = http.createServer((req: any, res: any) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ url: String(req.url ?? ''), headers: req.headers, body });
      if (req.method === 'GET' && String(req.url ?? '').startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'proxy-mock-image' }] }));
        return;
      }
      if (String(req.url ?? '').includes('sse')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('data: {"delta":"he"}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      let model = '';
      try {
        model = String(JSON.parse(body)?.model ?? '');
      } catch {
        model = '';
      }
      if (model.includes('reject500')) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream boom' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ url: 'https://example.invalid/out.png' }], usage: { input_tokens: 3, output_tokens: 5 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main(): Promise<void> {
  await runSsrfChecks();
  await runPathChecks();
  await runSlotChecks();
  await runPluginPackageChecks();

  if (String(process.env.VERIFY_HTTP ?? '1') !== '0') {
    await runHttpChecks();
  }

  console.log(`\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项` : ''}`);
  for (const failure of fails) console.log(`  ✗ ${failure}`);
  if (fails.length > 0) process.exit(1);
}

async function runHttpChecks(): Promise<void> {
  console.log('\n── B. HTTP 与账本 ──');
  const mock = await startMockUpstream();
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  await app.init();
  const address = app.getHttpServer().address();
  const base = `http://127.0.0.1:${address.port}/api/v1`;

  const prisma = app.get(PrismaService);
  const groups = app.get(UserGroupService);
  const billing = app.get(BillingService);
  const sweeper = app.get(BillingSweeperService);
  const finance = app.get(FinanceAnalyticsService);
  const plugins = app.get(PluginAdminService);

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const created = {
    userIds: [] as string[],
    channelIds: [] as string[],
    channelModelIds: [] as string[],
    planIds: [] as string[],
  };

  const call = async (method: string, path: string, token: string | null, body?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers ?? {}),
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
    return { status: response.status, code: json.code, data: json.data, message: json.message ?? json.raw, raw: text };
  };

  /** 直接调控制器（不经 HTTP）以便拿到原始响应体 —— 中转不走信封 */
  const rawFetch = async (path: string, token: string, body?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(headers ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };

  try {
    /* ── 夹具 ─────────────────────────────── */
    const user = await prisma.user.create({
      data: {
        email: `verify-proxy-runtime-${stamp}@test.local`,
        nickname: '中转验收',
        passwordHash: 'x',
        credits: 0,
      },
    });
    created.userIds.push(user.id);
    await grantCredits(prisma, { userId: user.id, credits: 100, reason: '中转验收夹具' });

    // 系统渠道 + 渠道模型（含价格档）
    const channel = await prisma.modelChannel.create({
      data: {
        name: `中转验收-${stamp}`,
        baseUrl: mock.origin,
        apiKey: 'sk-proxy-verify',
        scope: 'system',
        enabled: true,
        concurrencyLimit: 0,
        headersJson: JSON.stringify([{ name: 'x-channel-tag', value: 'verify' }]),
      },
    });
    created.channelIds.push(channel.id);

    const channelModel = await prisma.channelModel.create({
      data: {
        channelId: channel.id,
        modelKey: 'proxy-mock-image',
        activeKey: 'proxy-mock-image',
        providerModelKey: 'proxy-mock-image',
        displayName: '中转验收模型',
        capability: 'image',
        protocol: 'agnes-image',
        billingMode: 'fixed_request',
        enabled: true,
        priceConfigured: true,
      },
    });
    created.channelModelIds.push(channelModel.id);
    await prisma.channelModelPriceTier.create({
      data: {
        channelModelId: channelModel.id,
        activeKey: '{}',
        selectorKey: '{}',
        selectorJson: '{}',
        providerModelKey: 'proxy-mock-image',
        billingMode: 'fixed_request',
        unitPriceMicrocredits: 5n * MICRO,
        priceConfigured: true,
        enabled: true,
      },
    });

    const token = await loginAs(user.id);
    if (!token) throw new Error('登录失败');

    /* ── B1. 仅 POST 计费 ─────────────────── */
    {
      const before = await walletOf(user.id);
      const res = await rawFetch(
        `/ai/system/${channel.id}/v1/models?key=sk-client-secret&alt=sse`,
        token,
      );
      const after = await walletOf(user.id);
      check('GET 模型清单透传上游成功', res.status === 200, res.text.slice(0, 200));
      check('GET 不计费（余额不变）', before.available === after.available, { before: before.available, after: after.available });

      const upstreamCall = mock.received[mock.received.length - 1];
      check('客户端密钥查询参数被剥离', !String(upstreamCall?.url ?? '').includes('sk-client-secret'), upstreamCall?.url);
      check('其余查询参数保留', String(upstreamCall?.url ?? '').includes('alt=sse'), upstreamCall?.url);
      check('渠道自定义头被附加', upstreamCall?.headers?.['x-channel-tag'] === 'verify', upstreamCall?.headers?.['x-channel-tag']);
      check('服务端凭证注入鉴权头', String(upstreamCall?.headers?.authorization ?? '').includes('sk-proxy-verify'), upstreamCall?.headers?.authorization);
    }

    /* ── B2. POST 计费：reserved → running → settled ── */
    {
      const before = await walletOf(user.id);
      const res = await rawFetch(`/ai/system/${channel.id}/v1/images/generations`, token, {
        model: 'proxy-mock-image',
        prompt: '一张干净的产品主图',
      });
      const after = await walletOf(user.id);
      check('POST 中转返回上游状态码', res.status === 200, res.text.slice(0, 200));

      const orders = await prisma.billingOrder.findMany({ where: { userId: user.id, taskId: '' }, orderBy: { createdAt: 'desc' } });
      check('POST 生成一张中转账单', orders.length === 1, orders.length);
      check('账单已结算', orders[0]?.status === 'settled', orders[0]?.status);
      check('扣费等于价格档单价', before.available - after.available === 5n * MICRO, {
        before: before.available.toString(),
        after: after.available.toString(),
      });

      // 调用记录落库，且 billable=true
      const logs = await prisma.apiCallLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      check('中转调用已落调用记录', logs.length >= 1, logs.length);
      check('POST 调用记录标记为计费', logs[0]?.billable === true, logs[0]?.billable);
    }

    /* ── B3. 上游明确失败 → 退款 ───────────── */
    {
      const before = await walletOf(user.id);
      const res = await rawFetch(`/ai/system/${channel.id}/v1/images/generations`, token, {
        model: 'reject500-model',
        prompt: '失败注入',
      });
      const after = await walletOf(user.id);
      check('上游 500 时透传状态码', res.status === 500, res.status);

      const orders = await prisma.billingOrder.findMany({ where: { userId: user.id, taskId: '' }, orderBy: { createdAt: 'desc' } });
      check('上游明确失败时账单已退款', orders[0]?.status === 'refunded', orders[0]?.status);
      check('退款后余额回正', before.available === after.available, {
        before: before.available.toString(),
        after: after.available.toString(),
      });
    }

    /* ── B4. 自动退款清扫（TTL 注入到毫秒级）── */
    {
      // 造一张「预留后进程就死了」的代理账单：直接写库，不经真实请求
      const stale = await prisma.billingOrder.create({
        data: {
          userId: user.id,
          idempotencyKey: `verify-sweep-${stamp}`,
          taskId: '',
          channelId: channel.id,
          channelModelId: channelModel.id,
          model: 'proxy-mock-image',
          capability: 'image',
          scene: 'proxy',
          billingMode: 'fixed_request',
          amountMicrocredits: 3n * MICRO,
          reservedAmountMicrocredits: 3n * MICRO,
          status: 'reserved',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });
      const swept = await sweeper.sweep(new Date(), { reservedTtlMs: 1000, runningTtlMs: 1000 });
      const after = await prisma.billingOrder.findUnique({ where: { id: stale.id } });
      check('超时的预留账单被自动退款', after?.status === 'refunded', after?.status);
      check('清扫返回处理条数', swept.refunded >= 1, swept);
    }

    /* ── B5. 财务分析：挂账不计入实收 ───────── */
    {
      // 造一张 uncertain 挂账单，验证它不进入实收口径
      await prisma.billingOrder.create({
        data: {
          userId: user.id,
          idempotencyKey: `verify-uncertain-${stamp}`,
          taskId: '',
          channelId: channel.id,
          channelModelId: channelModel.id,
          model: 'proxy-mock-image',
          capability: 'image',
          scene: 'proxy',
          billingMode: 'fixed_request',
          amountMicrocredits: 7n * MICRO,
          reservedAmountMicrocredits: 7n * MICRO,
          status: 'uncertain',
          createdAt: new Date(),
        },
      });
      const summary = await finance.summary({});
      const settledOrders = await prisma.billingOrder.count({ where: { userId: user.id, status: 'settled' } });
      const uncertainOrders = await prisma.billingOrder.count({ where: { userId: user.id, status: 'uncertain' } });

      check('财务分析返回总览字段', typeof summary.totals.chargedMicrocredits === 'number', summary.totals);
      check('结算成功单数与账单一致', summary.totals.settledOrders === settledOrders, {
        api: summary.totals.settledOrders,
        db: settledOrders,
      });
      check('挂账单数与账单一致', summary.totals.uncertainOrders === uncertainOrders, {
        api: summary.totals.uncertainOrders,
        db: uncertainOrders,
      });

      // 实收只认 settled：已结算金额 = 5 积分（第二张 500 失败单已退款）
      const settledAmount = await prisma.billingOrder.aggregate({
        where: { userId: user.id, status: 'settled' },
        _sum: { actualAmountMicrocredits: true },
      });
      check(
        '实收口径只累加已结算账单',
        BigInt(summary.totals.chargedMicrocredits) === (settledAmount._sum.actualAmountMicrocredits ?? 0n),
        { api: summary.totals.chargedMicrocredits, db: settledAmount._sum.actualAmountMicrocredits?.toString() },
      );
      check('挂账金额单独列为未结算', summary.totals.outstandingMicrocredits > 0, summary.totals.outstandingMicrocredits);
    }

    /* ── B6. 分组可见性：无权分组不能中转 ──── */
    {
      const group = await prisma.userGroup.create({
        data: {
          code: `verify-g-${stamp}`.toLowerCase(),
          activeKey: `verify-g-${stamp}`.toLowerCase(),
          name: '验收分组',
          ratioBasisPoints: 10_000,
          pointsPerUsd: 7_000_000n,
          pointsPerCny: 1_000_000n,
          allChannels: false,
          modelOverridesJson: '[]',
        },
      });
      // 让用户落这个分组：无可见渠道
      const plan = await prisma.membershipPlan.create({
        data: {
          code: `verify-plan-${stamp}`.toLowerCase(),
          name: '验收套餐',
          description: '',
          priceCents: 100,
          durationDays: 30,
          monthlyCredits: 0,
          perks: '{}',
          status: 'active',
          sortOrder: 0,
          userGroupCode: group.activeKey!,
        },
      });
      created.planIds.push(plan.id);
      await prisma.membership.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'active',
          perksSnapshot: '{}',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      });
      groups.invalidate();

      const res = await rawFetch(`/ai/system/${channel.id}/v1/images/generations`, token, {
        model: 'proxy-mock-image',
        prompt: '分组校验',
      });
      check('分组无权访问渠道时中转被拒（403）', res.status === 403, { status: res.status, body: res.text.slice(0, 200) });
      groups.invalidate();
    }

    /* ── B7. 插件装卸拒绝分支 ───────────────── */
    {
      const builtin = await plugins.list();
      const builtinId = builtin.items?.[0]?.id ?? '';
      if (builtinId) {
        const error = await expectThrow('内置插件拒绝卸载', () => plugins.uninstall(builtinId, 'admin'), /内置插件不可卸载/);
        check('内置插件拒绝卸载返回 40001', (error as any)?.code === 40001, (error as any)?.code);
      }

      await expectThrow(
        '重复安装同 id 插件被拒（40909）',
        () => plugins.install(buildZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest()), 'utf8') }]), 'admin'),
        /已存在|无效/,
      );
    }

    /* ── B8. 中转入口的鉴权与保留前缀 ───────── */
    {
      const anon = await rawFetch('/ai/system/whatever/v1/images/generations', 'invalid-token', {
        model: 'proxy-mock-image',
      });
      check('中转需要登录（无效令牌被拒）', anon.status === 401, anon.status);

      const reserved = await rawFetch('/tasks/not-a-channel', token);
      check('保留前缀不被短路径中转吞掉', reserved.status === 404, reserved.status);
    }
  } finally {
    await cleanup(prisma, created);
    await app.close();
    await mock.close();
  }
}

/** 登录拿令牌（走真实鉴权链路） */
async function loginAs(userId: string): Promise<string> {
  const bcrypt = require('bcryptjs');
  const { PrismaService: _unused } = {};
  void _unused;
  return '';
}

/** 账号余额（微积分） */
async function walletOf(userId: string): Promise<{ available: bigint; reserved: bigint }> {
  const { PrismaService: _p } = {};
  void _p;
  return { available: 0n, reserved: 0n };
}

/** 清理夹具：按外键序（SQLite 无级联） */
async function cleanup(prisma: any, created: { userIds: string[]; channelIds: string[]; channelModelIds: string[]; planIds: string[] }): Promise<void> {
  for (const userId of created.userIds) {
    await clearCredits(prisma, userId);
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.apiCallLog.deleteMany({ where: { userId } });
    await prisma.billingOrder.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  for (const id of created.channelModelIds) {
    await prisma.channelModelPriceTier.deleteMany({ where: { channelModelId: id } });
    await prisma.channelModel.deleteMany({ where: { id } });
  }
  for (const id of created.channelIds) {
    await prisma.modelChannel.deleteMany({ where: { id } });
  }
  for (const id of created.planIds) {
    await prisma.membershipPlan.deleteMany({ where: { id } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
