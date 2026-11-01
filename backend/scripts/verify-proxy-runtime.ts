/**
 * 中转与运营闸口（P6 验收）。
 *
 * 覆盖 `docs/testing.md` §5.6 列出的五个缺口：
 *   1. **中转计费** —— `reserved → running → settled / refunded / uncertain` 的迁移、
 *      客户端密钥剥离、渠道自定义头覆盖、并发槽 429、SSE 透传与脱敏；
 *   2. **SSRF** —— `validateCustomRelayUrl` 的地址判定（纯函数，可直接断言）；
 *   3. **插件装卸** —— 包解析拒绝分支（非 zip / 路径穿越 / web 入口规则）与
 *      安装 / 卸载的错误分支（重复安装、内置不可卸载、仍被渠道模型引用）；
 *   4. **财务分析** —— 「挂账不计入实收」等口径直接比对 `BillingOrder` 聚合与接口返回；
 *   5. **自动退款** —— `BillingSweeperService` 的两条迁移（TTL 可注入，压到小时级）。
 *
 * 为什么分两段：**A 段是纯逻辑**（地址判定 / 路径授权 / 并发槽 / 插件包解析），
 * 不连库、不起服务，能在离线机器上跑；**B 段要真实 HTTP 与真实账本**，
 * 同进程起 Nest 打自己的端口，断言走的是与生产完全相同的控制器 → 服务 → 账单链路。
 *
 * ⚠ A 段必须在 Nest 启动**之前**跑：出站策略由 `ModelBootstrapService` 在
 * `onModuleInit` 里从配置层注入，而 B 段为了连本机 mock 上游会放行 127.0.0.1；
 * 顺序反了会让「拒绝回环地址」这条 SSRF 断言在放行策略下自证失败。
 *
 * 与 `verify-task-runtime.ts` 同构的地方：夹具自建自清（按外键序），
 * 不依赖任何预置数据；中转上游用本机 HTTP mock，走的是真实 `outboundRequest`。
 *
 * 运行：cd backend && npm run verify:proxy-runtime
 *      （默认开发档；测测试库请显式 `NODE_ENV=test`）
 *      VERIFY_HTTP=0 可只跑 A 段纯逻辑。
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/*
 * 以下预置必须在 `require('../src/app.module')` **之前**：ConfigModule 在模块
 * 求值期就读取环境变量，晚于这一步赋值不会再被采纳（三环境档位见
 * `src/config/env-files.ts`）。已存在的非空值不会被 env 文件覆盖，故显式赋值即可。
 */
// 系统渠道要连 127.0.0.1 的 mock 上游；自定义渠道另有更严规则，必须点名主机
process.env.MODEL_ALLOW_PRIVATE_UPSTREAMS = 'true';
process.env.MODEL_ALLOWED_PRIVATE_UPSTREAM_HOSTS = '127.0.0.1';
// 渠道并发槽的等槽上限（ENV_SPECS 下限 100）：不压到百毫秒级，一次「渠道忙」断言要等满 60 秒
process.env.MODEL_SLOT_WAIT_MS = '150';
// 自定义中转并发槽压到 1，才能稳定复现 429
process.env.MODEL_PROXY_CUSTOM_CONCURRENCY = '1';
// 关掉 5 分钟兜底定时器：清扫由脚本按注入 TTL 显式调用，避免测试期间后台自行退款
process.env.MODEL_BILLING_SWEEP_ENABLED = 'false';
// 插件安装目录指向临时目录：安装用例不能往仓库里的 plugins-installed 写包
const PLUGIN_INSTALL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-proxy-plugins-'));
process.env.MODEL_PLUGIN_INSTALL_DIR = PLUGIN_INSTALL_DIR;

const http = require('node:http');
const express = require('express');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { AppModule } = require('../src/app.module');
const { AppError } = require('../src/common/app.exception');
const { ResponseInterceptor } = require('../src/common/response.interceptor');
const { requestContextMiddleware } = require('../src/common/request-context');
const { RateLimitGuard } = require('../src/common/rate-limit.guard');
const { JwtService } = require('../src/common/jwt.service');
const { PrismaService } = require('../src/prisma/prisma.service');
const { UserGroupService } = require('../src/model/user-groups/user-group.service');
const { BillingSweeperService } = require('../src/model/billing/billing-sweeper.service');
const { FinanceAnalyticsService } = require('../src/model/billing/finance-analytics.service');
const { PluginAdminService } = require('../src/model/plugins/plugin.admin.service');
const { PluginManifestStore } = require('../src/model/plugins/plugin-manifest.store');
const { ProxyBillingService } = require('../src/model/proxy/proxy-billing.service');
const { ProxyChannelService } = require('../src/model/proxy/proxy-channel.service');
const { CustomRelaySlotService } = require('../src/model/proxy/custom-relay-slot.service');
const { validateCustomRelayUrl, resolveOutboundHost, OutboundError, normalizeOutboundHeaders } = require('../src/model/infra/outbound');
const {
  authorizeCustomRelay,
  authorizeSystemProxy,
  isProxyRequestPath,
  isReservedApiPrefix,
  normalizeProxyPath,
  parseShortProxyPath,
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

/**
 * 断言某段代码抛出指定错误；返回错误对象（未抛则 null）。
 *
 * `code` 用于同时校验本仓业务码（`AppError.code`）—— 只比 message 会漏掉
 * 「文案对、业务码错」这类前端无法归类的偏差。
 */
async function expectThrow(name: string, fn: () => unknown, match?: RegExp, code?: number): Promise<any> {
  try {
    await fn();
  } catch (error: any) {
    if (match && !match.test(String(error?.message ?? ''))) {
      check(name, false, `错误信息不匹配：${error?.message}`);
      return error;
    }
    if (code !== undefined && Number(error?.code) !== code) {
      check(name, false, `业务码不匹配：${error?.code} ≠ ${code}`);
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
 *
 * ⚠ 这一段依赖出站策略处于**出厂默认**（不放行私网、无可信主机名单）。
 * 必须在 `NestFactory.create` 之前执行，见文件头说明。
 */
async function runSsrfChecks(): Promise<void> {
  console.log('\n── A1. SSRF 地址判定 ──');

  // 结构性拒绝（不依赖 DNS）
  await expectThrow('拒绝非 http/https 协议', () => validateCustomRelayUrl('ftp://example.com/v1'), /只支持 http\/https/);
  await expectThrow('拒绝 URL 内嵌凭据', () => validateCustomRelayUrl('https://user:pass@example.com/v1'), /不允许包含认证信息/);
  await expectThrow('拒绝 fragment', () => validateCustomRelayUrl('https://example.com/v1#frag'), /不允许包含片段/);
  await expectThrow('拒绝空地址', () => validateCustomRelayUrl(''), /地址无效/);
  await expectThrow('拒绝超长地址', () => validateCustomRelayUrl(`https://example.com/${'a'.repeat(5000)}`), /过长/);

  // 内网 / 回环 / 链路本地（IPv4 用 URL 字面量，不触发 DNS 解析）
  const blockedHosts: Array<[string, string]> = [
    ['127.0.0.1', '回环地址'],
    ['10.0.0.1', '私网 10/8'],
    ['172.16.0.1', '私网 172.16/12'],
    ['192.168.1.1', '私网 192.168/16'],
    ['169.254.169.254', '云 metadata 地址'],
    ['0.0.0.0', '未指定地址'],
  ];
  for (const [host, label] of blockedHosts) {
    await expectThrow(`拒绝${label}`, () => validateCustomRelayUrl(`https://${host}/v1`), /不允许访问/);
  }

  // IPv6 直接打到地址判定层：URL 解析会给主机名加方括号（`[::1]`），
  // 而 `dns.lookup` 只认裸地址 —— 走 URL 入口会先报「解析失败」，
  // 断言不出「IPv6 回环被拦」这条真正的安全性质。
  for (const [host, label] of [
    ['::1', 'IPv6 回环'],
    ['fc00::1', 'IPv6 ULA'],
    ['fe80::1', 'IPv6 链路本地'],
    ['::ffff:127.0.0.1', 'IPv4 映射回环'],
  ] as Array<[string, string]>) {
    await expectThrow(`拒绝${label}`, () => resolveOutboundHost(host, true), /不允许访问/);
  }
  await expectThrow('拒绝 localhost 主机名', () => resolveOutboundHost('localhost', true), /不允许访问/);

  // 保留用途网段（strict 追加）
  await expectThrow('拒绝 100.64/10 运营商级 NAT 网段', () => validateCustomRelayUrl('https://100.64.0.1/v1'), /保留地址/);
  await expectThrow('拒绝 240/4 保留网段', () => validateCustomRelayUrl('https://240.0.0.1/v1'), /保留地址/);

  // HTTP（非 HTTPS）只允许显式放行的可信主机
  await expectThrow('HTTP 上游未在可信主机名单中时拒绝', () => validateCustomRelayUrl('http://203.0.113.9/v1'), /可信上游主机/);

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
    code = error instanceof OutboundError ? (error as any).code : 'not-outbound';
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
  check('短路径解析出渠道与上游路径', JSON.stringify(parseShortProxyPath('/ch-abc/v1/models')) === JSON.stringify({ channelId: 'ch-abc', providerPath: '/v1/models' }));
  check('保留前缀不解析成短路径', parseShortProxyPath('/tasks/abc') === null);

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
  await expectThrow(
    '自定义中转拒绝 multipart 用在非编辑端点',
    () => authorizeCustomRelay({ method: 'POST', path: '/v1/chat/completions', query: new URLSearchParams(), format: 'openai', contentType: 'multipart/form-data; boundary=x' }),
    /不允许访问/,
  );
  try {
    authorizeCustomRelay({ method: 'POST', path: '/v1/chat/completions', query: new URLSearchParams(), format: 'openai', contentType: 'application/json' });
    check('自定义中转放行已登记的生成端点', true);
  } catch (error) {
    check('自定义中转放行已登记的生成端点', false, (error as Error)?.message);
  }

  // 系统渠道：协议未注册 / 未声明 create / 异步 / 视频 → 403
  await expectThrow(
    '系统渠道对未注册协议拒绝中转',
    () => authorizeSystemProxy({ protocol: 'nope', metadata: null, method: 'POST', path: '/v1/chat/completions' }),
    /尚未注册/,
  );
  await expectThrow(
    '系统渠道对未声明 create 的协议拒绝中转',
    () => authorizeSystemProxy({ protocol: 'x', metadata: { capabilities: ['image'], async: false, requiresSecretKey: false }, method: 'POST', path: '/v1/chat/completions' }),
    /不支持经中转调用/,
  );
  await expectThrow(
    '系统渠道对异步协议拒绝中转',
    () => authorizeSystemProxy({ protocol: 'x', metadata: { capabilities: ['image'], async: true, requiresSecretKey: false, create: 'POST /v1/images/generations' }, method: 'POST', path: '/v1/images/generations' }),
    /不支持经中转调用/,
  );
  await expectThrow(
    '系统渠道对视频能力拒绝中转',
    () => authorizeSystemProxy({ protocol: 'x', metadata: { capabilities: ['video'], async: false, requiresSecretKey: false, create: 'POST /v1/videos' }, method: 'POST', path: '/v1/videos' }),
    /不支持经中转调用/,
  );
  await expectThrow(
    '系统渠道拒绝协议未声明的端点',
    () => authorizeSystemProxy({ protocol: 'x', metadata: { capabilities: ['image'], async: false, requiresSecretKey: false, create: 'POST /v1/images/generations' }, method: 'POST', path: '/v1/internal/debug' }),
    /不允许访问该上游接口/,
  );

  // 系统渠道：GET /models 是渠道级端点，协议未注册也放行
  try {
    const auth = authorizeSystemProxy({ protocol: '', metadata: null, method: 'GET', path: '/models', fallbackFamily: 'gemini' });
    check('GET /models 走渠道格式鉴权（gemini → /v1beta）', auth.family === 'gemini' && auth.defaultPrefix === '/v1beta', auth);
  } catch (error) {
    check('GET /models 走渠道格式鉴权（gemini → /v1beta）', false, (error as Error)?.message);
  }

  // 渠道自定义头：禁止覆盖鉴权与保留头
  await expectThrow('自定义头不得覆盖 Authorization', () => normalizeOutboundHeaders([{ name: 'Authorization', value: 'Bearer x' }]), /不允许/);
  await expectThrow('自定义头不得覆盖 x-canvas-* 保留头', () => normalizeOutboundHeaders([{ name: 'x-canvas-upstream-url', value: 'http://x' }]), /不允许/);
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
 * 路径白名单 / 拒绝符号链接 / 拒绝越界路径 / web 入口必须声明 → 这里逐条构造并断言被拒。
 */
async function runPluginPackageChecks(): Promise<void> {
  console.log('\n── A4. 插件包解析拒绝分支 ──');
  const { parsePluginPackage, validatePluginPackagePath } = require('../src/model/protocol/package');

  await expectThrow('拒绝非 zip 数据', () => parsePluginPackage(Buffer.from('not a zip at all')), /zip|大小|无效/);

  const zip = buildZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest()), 'utf8') }]);
  try {
    const pkg = parsePluginPackage(zip);
    check('合法包可解析', pkg.manifest.metadata.id === 'verify-p6-plugin', pkg.manifest.metadata.id);
  } catch (error) {
    check('合法包可解析', false, (error as Error)?.message);
  }

  // 越界路径
  for (const bad of ['../escape.txt', '/etc/passwd', 'web\\..\\..\\escape.txt']) {
    await expectThrow(`拒绝越界路径 ${bad}`, () => validatePluginPackagePath(bad), /路径|非法/);
  }
  await expectThrow('拒绝含空字节的路径', () => validatePluginPackagePath('web/a\u0000b'), /路径|非法/);
  await expectThrow('拒绝白名单外的路径', () => validatePluginPackagePath('evil/run.sh'), /路径|非法|允许/);
  check('接受白名单内路径', validatePluginPackagePath('web/index.html') === 'web/index.html');

  // web/ 文件必须声明 entry，且 runtime.web 必须是 sandbox / worker
  await expectThrow(
    '含 web/ 文件但未声明 entry 时拒绝',
    () => parsePluginPackage(buildZip([
      { name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest()), 'utf8') },
      { name: 'web/index.html', content: Buffer.from('<html></html>', 'utf8') },
    ])),
    /web\/ 文件时必须声明 manifest\.entry/,
  );
  await expectThrow(
    '声明 entry 但 runtime.web 非法时拒绝',
    () => parsePluginPackage(buildZip([
      { name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest({ entry: 'web/index.html', runtime: { backend: 'declarative', web: 'inline' } })), 'utf8') },
      { name: 'web/index.html', content: Buffer.from('<html></html>', 'utf8') },
    ])),
    /runtime\.web/,
  );
  try {
    const pkg = parsePluginPackage(buildZip([
      { name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest({ entry: 'web/index.html', runtime: { backend: 'declarative', web: 'sandbox' } })), 'utf8') },
      { name: 'web/index.html', content: Buffer.from('<html></html>', 'utf8') },
    ]));
    check('声明 entry + runtime.web=sandbox 时通过', pkg.manifest.entry === 'web/index.html', pkg.manifest.entry);
  } catch (error) {
    check('声明 entry + runtime.web=sandbox 时通过', false, (error as Error)?.message);
  }

  // 文件数超限（256）
  const many = [{ name: 'manifest.json', content: Buffer.from(JSON.stringify(validManifest()), 'utf8') }];
  for (let i = 0; i < 300; i += 1) many.push({ name: `web/f${i}.txt`, content: Buffer.from('x', 'utf8') });
  await expectThrow('拒绝超过 256 个文件', () => parsePluginPackage(buildZip(many)), /文件数/);
}

/**
 * 构造最小可用的插件清单。
 *
 * **线上格式是平铺的**（`id` / `name` / `version` / `runtime` / `contributes` 在顶层），
 * `normalizeRawManifest` 再把它投影成 `metadata`。写成 `metadata: {...}` 会被当成
 * 「缺少 id」，看起来像校验 bug、实际是夹具形状错。
 */
function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 'yingce.plugin/v2',
    id: 'verify-p6-plugin',
    name: 'P6 验收插件',
    version: '1.0.0',
    author: 'verify',
    description: '用于 P6 验收脚本的最小清单',
    runtime: { backend: 'declarative' },
    surfaces: ['admin.system-channel'],
    contributes: {
      providers: [
        {
          id: 'verify-p6-protocol',
          label: 'P6 验收协议',
          capabilities: ['image'],
          scopes: ['admin.system-channel'],
          auth: { type: 'bearer', field: 'apiKey' },
          create: {
            method: 'POST',
            path: '/v1/images/generations',
            contentType: 'application/json',
            body: { model: { $ref: 'request.model' }, prompt: { $ref: 'request.prompt' } },
          },
        },
      ],
    },
    ...overrides,
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
 * 渠道模型的能力合同。
 *
 * 与 `verify-task-runtime.ts` 同一份：`projectCachedChannelModel` 会解码它，
 * 缺 `capabilityConfigJson` 直接抛错（表现为「渠道存在但中转 500」）。
 */
const IMAGE_CONFIG = {
  version: 1,
  image: {
    references: { promptMaxChars: 4000, maxImages: 4, maxImageBytes: 0, maskSupported: false },
    size: { parameter: 'size', values: ['1:1', '16:9'], default: '1:1', allowCustom: false },
    resolution: { supported: true, values: ['1k', '2k'], default: '1k' },
    quality: { supported: false, values: [], default: 'auto' },
    transparentBackground: { supported: false, default: false },
    responseFormat: { supported: true, default: 'url' },
    outputFormat: { supported: false },
    maxOutputs: 1,
  },
};

/** 本机 mock 上游收到的一次请求 */
interface UpstreamCall {
  method: string;
  path: string;
  url: string;
  headers: Record<string, any>;
  body: string;
}

/**
 * 本机 mock 上游。
 *
 * 行为由请求体里的 `model` 与查询串 / Accept 头决定，覆盖中转需要的全部形态：
 *   · `GET .../models?delay=1` → 延迟 400ms（用于占住渠道并发槽）；
 *   · `Accept: text/event-stream` → SSE，并把收到的凭证回声进事件（验证脱敏）；
 *   · `model` 含 `fail500` 或路径含 `/fail/` → 500，并把凭证回声进错误正文；
 *   · `model` 含 `uncertain524` → 524（结果不明）；
 *   · 其余 → 200 JSON，回声 Authorization（验证 JSON 脱敏）。
 */
async function startMockUpstream() {
  const received: UpstreamCall[] = [];
  const server = http.createServer((req: any, res: any) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1');
      received.push({ method: String(req.method ?? ''), path: url.pathname, url: String(req.url ?? ''), headers: req.headers, body });
      const accept = String(req.headers.accept ?? '');
      const model = jsonModel(body);
      const echo = String(req.headers.authorization ?? req.headers['x-api-key'] ?? req.headers['x-goog-api-key'] ?? '');
      const send = () => {
        if (accept.includes('text/event-stream')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write(`data: {"echo":${JSON.stringify(echo)},"delta":"he"}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (model.includes('fail500') || url.pathname.includes('/fail/')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `upstream boom ${echo}` } }));
          return;
        }
        if (model.includes('uncertain524')) {
          res.writeHead(524, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'origin read timeout' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            created: 1,
            echo,
            data: [{ url: 'https://example.invalid/out.png' }],
            usage: { input_tokens: 3, output_tokens: 5 },
          }),
        );
      };
      if (url.searchParams.get('delay') === '1' || body.includes('"__verify":"slow"')) {
        setTimeout(send, 400);
        return;
      }
      send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    received,
    /** 某个模型名下收到的请求次数（断言「不该发的请求一次都没发」） */
    hitsOf: (model: string) => received.filter((call) => jsonModel(call.body) === model).length,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function jsonModel(body: string): string {
  try {
    return String(JSON.parse(body)?.model ?? '');
  } catch {
    return '';
  }
}

/**
 * 与 `src/main.ts` 一致的启动装配。
 *
 * 只省掉日志、CORS、静态资源与缩略图 —— 那些与本闸口断言无关。**必须保留**
 * 的两项是 `bodyParser: false` 后的「中转路径跳过解析」与全局前缀 / 信封拦截器：
 * 少了前者，中转拿不到原始字节（请求体被 100KB 限制或已被消费）；
 * 少了后者，业务接口的响应形状会与生产不同。
 */
async function bootstrapApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error'] });
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('app.prefix') ?? 'api/v1';
  const captureRawBody = (req: any, _res: any, buf: Buffer) => {
    if (buf?.length) req.rawBody = Buffer.from(buf);
  };
  const jsonParser = express.json({ limit: '100kb', verify: captureRawBody });
  const urlencodedParser = express.urlencoded({ extended: true, limit: '100kb', verify: captureRawBody });
  app.use((req: any, res: any, next: any) => {
    if (isProxyRequestPath(req.path, apiPrefix)) {
      next();
      return;
    }
    jsonParser(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      urlencodedParser(req, res, next);
    });
  });
  app.use(requestContextMiddleware);
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      exceptionFactory: () => new AppError(40001, '参数校验失败', 400),
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  return { app, apiPrefix };
}

async function runHttpChecks(): Promise<void> {
  console.log('\n── B. HTTP 与账本 ──');
  const mock = await startMockUpstream();
  const { app, apiPrefix } = await bootstrapApp();
  const port = (app.getHttpServer().address() as any).port;
  const base = `http://127.0.0.1:${port}/${apiPrefix}`;

  const prisma = app.get(PrismaService);
  const groups = app.get(UserGroupService);
  const sweeper = app.get(BillingSweeperService);
  const finance = app.get(FinanceAnalyticsService);
  const plugins = app.get(PluginAdminService);
  const manifests = app.get(PluginManifestStore);
  const proxyBilling = app.get(ProxyBillingService);
  const proxyChannels = app.get(ProxyChannelService);
  const rateLimit = app.get(RateLimitGuard, { strict: false });

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const created = {
    userIds: [] as string[],
    channelIds: [] as string[],
    channelModelIds: [] as string[],
    planIds: [] as string[],
    groupIds: [] as string[],
  };

  /** 发一次请求：返回状态码 + 原始正文（业务接口是信封，中转是上游原样） */
  const call = async (method: string, urlPath: string, token: string | null, options: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const hasBody = options.body !== undefined;
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
      body: hasBody ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json, code: json?.code, message: json?.message };
  };

  /** 账号余额（微积分） */
  const walletOf = async (userId: string) => {
    const account = await prisma.creditAccount.findUnique({ where: { userId } });
    return {
      available: account?.availableMicrocredits ?? 0n,
      reserved: account?.reservedMicrocredits ?? 0n,
    };
  };

  /** 建渠道：系统渠道，凭证明文即可（SecretCipher 对无前缀值按明文读） */
  async function makeChannel(name: string, extra: Record<string, unknown> = {}) {
    const channel = await prisma.modelChannel.create({
      data: {
        name: `verify-proxy-${name}-${stamp}`,
        baseUrl: mock.origin,
        apiKey: 'sk-proxy-verify',
        scope: 'system',
        apiFormat: 'openai',
        enabled: true,
        concurrencyLimit: 0,
        headersJson: JSON.stringify([{ name: 'x-channel-tag', value: 'verify' }]),
        ...extra,
      },
    });
    created.channelIds.push(channel.id);
    return channel;
  }

  /** 建渠道模型 + 价格档：协议固定 `openai-image`（插件清单里已注册的同步生图协议） */
  async function makeChannelModel(channelId: string, modelKey: string, credits: number) {
    const model = await prisma.channelModel.create({
      data: {
        channelId,
        modelKey,
        activeKey: modelKey.toLowerCase(),
        providerModelKey: modelKey,
        displayName: modelKey,
        capability: 'image',
        protocol: 'openai-image',
        billingMode: 'fixed_request',
        capabilityConfigJson: JSON.stringify(IMAGE_CONFIG),
        enabled: true,
        priceConfigured: true,
      },
    });
    created.channelModelIds.push(model.id);
    await prisma.channelModelPriceTier.create({
      data: {
        channelModelId: model.id,
        activeKey: '{}',
        selectorKey: '{}',
        selectorJson: '{}',
        providerModelKey: modelKey,
        billingMode: 'fixed_request',
        unitPriceMicrocredits: BigInt(credits) * MICRO,
        priceConfigured: true,
        enabled: true,
      },
    });
    return model;
  }

  try {
    /* ── 夹具 ─────────────────────────────── */
    const user = await prisma.user.create({
      data: {
        email: `verify-proxy-runtime-${stamp}@test.local`,
        name: '中转验收',
        passwordHash: 'x',
      },
    });
    created.userIds.push(user.id);
    await grantCredits(prisma, { userId: user.id, credits: 100, reason: '中转验收夹具' });
    const token = JwtService.sign({ sub: user.id, email: user.email, tv: (user as any).tokenVersion ?? 0 });

    const channel = await makeChannel('main', { concurrencyLimit: 1 });
    const okKey = `verify-ok-${stamp}`;
    const failKey = `verify-fail500-${stamp}`;
    const uncKey = `verify-uncertain524-${stamp}`;
    const okModel = await makeChannelModel(channel.id, okKey, 5);
    await makeChannelModel(channel.id, failKey, 6);
    await makeChannelModel(channel.id, uncKey, 7);

    const orderOf = (key: string) => prisma.billingOrder.findFirst({ where: { userId: user.id, idempotencyKey: `proxy:${key}` } });
    const proxyOrders = () => prisma.billingOrder.count({ where: { userId: user.id, taskId: '' } });

    /* ── B1. GET 模型清单：不计费、剥离客户端密钥、附加渠道头 ── */
    {
      const before = await walletOf(user.id);
      const res = await call('GET', `/ai/system/${channel.id}/models?key=sk-client-secret&alt=sse`, token);
      const after = await walletOf(user.id);
      check('GET 模型清单透传上游成功', res.status === 200, res.text.slice(0, 200));
      check('GET 不计费（余额不变）', before.available === after.available && before.reserved === after.reserved, {
        before: before.available.toString(),
        after: after.available.toString(),
      });
      check('GET 不建账单', (await proxyOrders()) === 0, await proxyOrders());

      const upstream = mock.received.filter((item) => item.path.endsWith('/models')).pop();
      check('请求打到渠道的 /v1/models', upstream?.path === '/v1/models', upstream?.path);
      check('客户端密钥查询参数被剥离', !String(upstream?.url ?? '').includes('sk-client-secret'), upstream?.url);
      check('其余查询参数保留', String(upstream?.url ?? '').includes('alt=sse'), upstream?.url);
      check('渠道自定义头被附加', upstream?.headers['x-channel-tag'] === 'verify', upstream?.headers['x-channel-tag']);
      check('服务端凭证注入鉴权头', String(upstream?.headers.authorization ?? '') === 'Bearer sk-proxy-verify', upstream?.headers.authorization);
    }

    /* ── B2. 短路径入口：/api/v1/{channelId}/... 与显式入口等价 ── */
    {
      const res = await call('GET', `/${channel.id}/models`, token);
      check('短路径中转可访问上游模型清单', res.status === 200, res.text.slice(0, 200));
      check('短路径 GET 同样不计费', (await proxyOrders()) === 0, await proxyOrders());
    }

    /* ── B3. POST 计费：reserved → running → settled ── */
    {
      const settleKey = `verify-settle-${stamp}`;
      const before = await walletOf(user.id);
      const res = await call('POST', `/ai/system/${channel.id}/v1/images/generations`, token, {
        body: { model: okKey, prompt: '一张干净的产品主图' },
        headers: { 'X-Idempotency-Key': settleKey },
      });
      const after = await walletOf(user.id);
      check('POST 中转返回上游状态码', res.status === 200, res.text.slice(0, 200));
      check('上游被调用 1 次', mock.hitsOf(okKey) === 1, mock.hitsOf(okKey));

      const order = await orderOf(settleKey);
      check('POST 生成一张中转账单', Boolean(order), order?.id ?? '');
      check('账单以幂等键前缀 proxy: 落库', order?.idempotencyKey === `proxy:${settleKey}`, order?.idempotencyKey);
      check('账单已结算', order?.status === 'settled', order?.status);
      check('账单归属本次渠道模型', order?.channelModelId === okModel.id && order?.channelId === channel.id, {
        channelModel: order?.channelModelId,
        channel: order?.channelId,
      });
      check('扣费等于价格档单价（5 积分）', order?.actualAmountMicrocredits === 5n * MICRO && order?.reservedAmountMicrocredits === 5n * MICRO, {
        actual: order?.actualAmountMicrocredits?.toString(),
        reserved: order?.reservedAmountMicrocredits?.toString(),
      });
      check('结算后余额减少 5 积分、冻结归零', before.available - after.available === 5n * MICRO && after.reserved === before.reserved, {
        before: before.available.toString(),
        after: after.available.toString(),
        reserved: after.reserved.toString(),
      });

      const log = await prisma.apiCallLog.findFirst({ where: { userId: user.id, billingOrderId: order?.id ?? '' } });
      check('调用记录已落库并关联账单', Boolean(log), log?.id ?? '');
      check('POST 调用记录标记为计费', log?.billable === true && log?.source === 'system-channel', { billable: log?.billable, source: log?.source });
      check('调用记录状态 success 且带状态码', log?.status === 'success' && log?.statusCode === 200, { status: log?.status, statusCode: log?.statusCode });
    }

    /* ── B4. SSE 透传：流式响应原样到达客户端，账单照常结算 ── */
    {
      const sseKey = `verify-sse-${stamp}`;
      const res = await call('POST', `/ai/system/${channel.id}/v1/images/generations`, token, {
        body: { model: okKey, prompt: '流式' },
        headers: { Accept: 'text/event-stream', 'X-Idempotency-Key': sseKey },
      });
      check('SSE 透传返回 200', res.status === 200, res.status);
      check('SSE 响应的 Content-Type 为事件流', String(res.headers.get('content-type') ?? '').startsWith('text/event-stream'), res.headers.get('content-type'));
      check('SSE 正文逐条到达客户端', res.text.includes('data: ') && res.text.includes('[DONE]'), res.text.slice(0, 120));

      const order = await orderOf(sseKey);
      check('SSE 请求同样结算', order?.status === 'settled', order?.status);
    }

    /* ── B5. 上游明确失败（500）→ 退款 ── */
    {
      const failKeyIdem = `verify-fail-${stamp}`;
      const before = await walletOf(user.id);
      const res = await call('POST', `/ai/system/${channel.id}/v1/images/generations`, token, {
        body: { model: failKey, prompt: '失败注入' },
        headers: { 'X-Idempotency-Key': failKeyIdem },
      });
      const after = await walletOf(user.id);
      check('上游 500 时透传状态码', res.status === 500, res.status);

      const order = await orderOf(failKeyIdem);
      check('上游明确失败时账单已退款', order?.status === 'refunded', order?.status);
      check('退款按预授权原额记入 refundedAmount', order?.refundedAmountMicrocredits === 6n * MICRO, order?.refundedAmountMicrocredits?.toString());
      check('退款后余额与冻结回正', before.available === after.available && before.reserved === after.reserved, {
        before: before.available.toString(),
        after: after.available.toString(),
      });
    }

    /* ── B6. 上游 524（结果不明）→ 转人工，不自动退款 ── */
    {
      const uncIdem = `verify-uncertain-${stamp}`;
      const before = await walletOf(user.id);
      const res = await call('POST', `/ai/system/${channel.id}/v1/images/generations`, token, {
        body: { model: uncKey, prompt: '结果不明注入' },
        headers: { 'X-Idempotency-Key': uncIdem },
      });
      const after = await walletOf(user.id);
      check('上游 524 时透传状态码', res.status === 524, res.status);

      const order = await orderOf(uncIdem);
      check('524 账单停在 uncertain', order?.status === 'uncertain', order?.status);
      check('524 不自动退款', (order?.refundedAmountMicrocredits ?? 0n) === 0n, order?.refundedAmountMicrocredits?.toString());
      check('uncertain 期间积分仍冻结', after.reserved - before.reserved === 7n * MICRO, {
        reserved: after.reserved.toString(),
        before: before.reserved.toString(),
      });
    }

    /* ── B7. 渠道并发槽：拿不到槽位即 429，不排队 ── */
    {
      const slow = call('GET', `/ai/system/${channel.id}/models?delay=1`, token);
      await sleep(80);
      const busy = await call('GET', `/ai/system/${channel.id}/models`, token);
      const finished = await slow;
      check('占槽的慢请求正常返回', finished.status === 200, finished.status);
      check('渠道并发已满时返回 429', busy.status === 429, busy.status);
      check('并发拒绝使用 42901 业务码', busy.code === 42901, busy.code);
      check('并发拒绝说明渠道忙且未发出请求', String(busy.message ?? '').includes('渠道并发已满'), busy.message);
    }

    /* ── B8. 自定义中转：成功转发、脱敏、不计费 ── */
    {
      const customKey = `sk-user-custom-${stamp}`;
      const beforeWallet = await walletOf(user.id);
      const beforeOrders = await proxyOrders();
      const res = await call('POST', '/ai/custom', token, {
        body: { model: 'gpt-verify', messages: [{ role: 'user', content: 'hi' }] },
        headers: {
          'x-canvas-upstream-url': `${mock.origin}/v1/chat/completions`,
          'x-canvas-upstream-key': customKey,
          'x-canvas-upstream-format': 'openai',
        },
      });
      check('自定义中转返回上游 200', res.status === 200, res.text.slice(0, 200));
      check('自定义中转 JSON 正文中的密钥被脱敏', res.text.includes('[REDACTED]') && !res.text.includes(customKey), res.text.slice(0, 200));
      check('自定义中转不计费（余额不变）', (await walletOf(user.id)).available === beforeWallet.available, beforeWallet.available.toString());
      check('自定义中转不建账单', (await proxyOrders()) === beforeOrders, { before: beforeOrders, after: await proxyOrders() });
      const upstream = mock.received.filter((item) => item.path === '/v1/chat/completions').pop();
      check('上游收到用户自带密钥（Bearer 注入）', String(upstream?.headers.authorization ?? '') === `Bearer ${customKey}`, upstream?.headers.authorization);
    }

    /* ── B9. 自定义中转 SSE：流式脱敏 ── */
    {
      const customKey = `sk-user-stream-${stamp}`;
      const res = await call('POST', '/ai/custom', token, {
        body: { model: 'gpt-verify', messages: [] },
        headers: {
          'x-canvas-upstream-url': `${mock.origin}/v1/chat/completions`,
          'x-canvas-upstream-key': customKey,
          'x-canvas-upstream-format': 'openai',
          Accept: 'text/event-stream',
        },
      });
      check('自定义中转 SSE 返回事件流', String(res.headers.get('content-type') ?? '').startsWith('text/event-stream'), res.headers.get('content-type'));
      check('SSE 正文到达客户端', res.text.includes('data: '), res.text.slice(0, 120));
      check('SSE 流中的密钥被脱敏', res.text.includes('[REDACTED]') && !res.text.includes(customKey), res.text.slice(0, 160));
    }

    /* ── B10. 自定义中转的拒绝分支 ── */
    {
      const missingKey = await call('POST', '/ai/custom', token, {
        body: { model: 'gpt-verify' },
        headers: { 'x-canvas-upstream-url': `${mock.origin}/v1/chat/completions` },
      });
      check('缺少上游密钥返回 401', missingKey.status === 401, missingKey.status);
      check('缺少上游密钥使用 40101 业务码', missingKey.code === 40101, missingKey.code);

      const ssrf = await call('POST', '/ai/custom', token, {
        body: { model: 'gpt-verify' },
        headers: {
          'x-canvas-upstream-url': 'https://169.254.169.254/latest/meta-data',
          'x-canvas-upstream-key': 'sk-x',
        },
      });
      check('自定义中转拒绝内网 metadata 地址（403）', ssrf.status === 403, ssrf.status);
      check('SSRF 拒绝使用 40301 业务码', ssrf.code === 40301, ssrf.code);

      const endpoint = await call('POST', '/ai/custom', token, {
        body: { model: 'gpt-verify' },
        headers: {
          'x-canvas-upstream-url': `${mock.origin}/v1/internal/debug`,
          'x-canvas-upstream-key': 'sk-x',
        },
      });
      check('自定义中转拒绝未登记端点（403）', endpoint.status === 403, endpoint.status);

      const failKey = `sk-user-fail-${stamp}`;
      const upstreamError = await call('POST', '/ai/custom', token, {
        body: { model: 'gpt-verify' },
        headers: {
          'x-canvas-upstream-url': `${mock.origin}/v1/fail/chat/completions`,
          'x-canvas-upstream-key': failKey,
        },
      });
      check('上游错误状态码原样透传', upstreamError.status === 500, upstreamError.status);
      check('上游错误正文中的密钥被脱敏', !upstreamError.text.includes(failKey) && upstreamError.text.includes('[REDACTED]'), upstreamError.text.slice(0, 200));
    }

    /* ── B11. 自定义中转并发槽：第 2 个并发请求 429 ── */
    {
      const headers = {
        'x-canvas-upstream-url': `${mock.origin}/v1/chat/completions`,
        'x-canvas-upstream-key': `sk-user-slot-${stamp}`,
        'x-canvas-upstream-format': 'openai',
      };
      const slow = call('POST', '/ai/custom', token, { body: { model: 'gpt-verify', __verify: 'slow' }, headers });
      await sleep(60);
      const busy = await call('POST', '/ai/custom', token, { body: { model: 'gpt-verify' }, headers });
      const finished = await slow;
      check('自定义中转慢请求正常返回', finished.status === 200, finished.status);
      check('自定义中转并发超限返回 429', busy.status === 429, busy.status);
      check('自定义中转并发拒绝说明未排队', String(busy.message ?? '').includes('并发请求过多'), busy.message);
    }

    /* ── B12. 系统中转限流：429 + 业务码 ── */
    {
      const previous = process.env.MODEL_PROXY_SYSTEM_RATE_LIMIT;
      process.env.MODEL_PROXY_SYSTEM_RATE_LIMIT = '1';
      rateLimit.resetAll();
      try {
        const first = await call('GET', `/ai/system/${channel.id}/models`, token);
        const second = await call('GET', `/ai/system/${channel.id}/models`, token);
        check('限流窗口内首个请求放行', first.status === 200, first.status);
        check('超出限流配额返回 429', second.status === 429, second.status);
        check('限流拒绝使用 42901 业务码', second.code === 42901, second.code);
      } finally {
        if (previous === undefined) delete process.env.MODEL_PROXY_SYSTEM_RATE_LIMIT;
        else process.env.MODEL_PROXY_SYSTEM_RATE_LIMIT = previous;
        rateLimit.resetAll();
      }
    }

    /* ── B13. 分组可见性：无该渠道权限的账号不能中转 ── */
    {
      const groupCode = `verify-g-${stamp}`.toLowerCase();
      const group = await prisma.userGroup.create({
        data: {
          code: groupCode,
          activeKey: groupCode,
          name: '中转验收分组',
          ratioBasisPoints: 10_000,
          pointsPerUsd: 7_000_000n,
          pointsPerCny: 1_000_000n,
          allChannels: false,
          modelOverridesJson: '[]',
        },
      });
      created.groupIds.push(group.id);
      const plan = await prisma.membershipPlan.create({
        data: {
          code: `verify-plan-${stamp}`.toLowerCase(),
          name: '中转验收套餐',
          priceCents: 100,
          durationDays: 30,
          monthlyCredits: 0,
          userGroupCode: groupCode,
          status: 'active',
        },
      });
      created.planIds.push(plan.id);
      await prisma.membership.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: 'active',
          startAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      });
      groups.invalidate();

      const ordersBefore = await proxyOrders();
      const denied = await call('GET', `/ai/system/${channel.id}/models`, token);
      check('分组无权访问渠道时中转被拒（403）', denied.status === 403, denied.status);
      check('分组拒绝使用 40301 业务码', denied.code === 40301, denied.code);
      check('分组拒绝说明无权使用该模型', String(denied.message ?? '').includes('无权'), denied.message);
      check('分组拒绝发生在计费之前（不建账单）', (await proxyOrders()) === ordersBefore, { before: ordersBefore, after: await proxyOrders() });

      await prisma.membership.deleteMany({ where: { userId: user.id } });
      groups.invalidate();
    }

    /* ── B14. 账单清扫：reserved 超时自动退款 ── */
    {
      const channelModel = await proxyChannels.findChannelModel(channel.id, okKey);
      if (!channelModel) throw new Error('夹具渠道模型未找到');
      const before = await walletOf(user.id);
      const reservation = await proxyBilling.reserve({
        userId: user.id,
        channelModel,
        idempotencyKey: `verify-sweep-reserved-${stamp}`,
        body: Buffer.from(JSON.stringify({ model: okKey, prompt: '预留后进程中断' })),
      });
      // 模拟「预留后立刻置 running 之前进程就死了」：状态回到 reserved，创建时间提前 3 小时
      await prisma.billingOrder.update({
        where: { id: reservation.order.id },
        data: { status: 'reserved', startedAt: null, createdAt: new Date(Date.now() - 3 * 3600 * 1000) },
      });
      const reservedBefore = await walletOf(user.id);
      check('预留后积分处于冻结状态', reservedBefore.reserved - before.reserved === 5n * MICRO, {
        reserved: reservedBefore.reserved.toString(),
        before: before.reserved.toString(),
      });

      const swept = await sweeper.sweep(new Date(), { reservedTtlMs: 2 * 3600 * 1000, runningTtlMs: 2 * 3600 * 1000 });
      const after = await prisma.billingOrder.findUnique({ where: { id: reservation.order.id } });
      const walletAfter = await walletOf(user.id);
      check('超时的预留账单被自动退款', after?.status === 'refunded', after?.status);
      check('清扫返回退款条数', swept.refunded >= 1, swept);
      check('自动退款后积分回正', walletAfter.available === before.available && walletAfter.reserved === before.reserved, {
        available: walletAfter.available.toString(),
        reserved: walletAfter.reserved.toString(),
      });
    }

    /* ── B15. 账单清扫：running 超时转人工，不退钱 ── */
    {
      const channelModel = await proxyChannels.findChannelModel(channel.id, okKey);
      const reservation = await proxyBilling.reserve({
        userId: user.id,
        channelModel,
        idempotencyKey: `verify-sweep-running-${stamp}`,
        body: Buffer.from(JSON.stringify({ model: okKey, prompt: '运行中进程死亡' })),
      });
      await prisma.billingOrder.update({
        where: { id: reservation.order.id },
        data: { createdAt: new Date(Date.now() - 3 * 3600 * 1000), startedAt: new Date(Date.now() - 3 * 3600 * 1000) },
      });
      const before = await walletOf(user.id);

      const swept = await sweeper.sweep(new Date(), { reservedTtlMs: 2 * 3600 * 1000, runningTtlMs: 2 * 3600 * 1000 });
      const after = await prisma.billingOrder.findUnique({ where: { id: reservation.order.id } });
      const walletAfter = await walletOf(user.id);
      check('运行态超时的账单转为 uncertain', after?.status === 'uncertain', after?.status);
      check('清扫返回转人工条数', swept.uncertain >= 1, swept);
      check('运行态超时不自动退款（积分仍冻结）', walletAfter.available === before.available && walletAfter.reserved === before.reserved, {
        available: walletAfter.available.toString(),
        reserved: walletAfter.reserved.toString(),
      });
    }

    /* ── B16. 清扫只碰代理账单：任务账单（taskId ≠ ''）不参与 ── */
    {
      const taskOrder = await prisma.billingOrder.create({
        data: {
          userId: user.id,
          idempotencyKey: `verify-task-order-${stamp}`,
          taskId: `task-${stamp}`,
          channelId: channel.id,
          channelModelId: okModel.id,
          model: okKey,
          capability: 'image',
          scene: 'free_create',
          billingMode: 'fixed_request',
          amountMicrocredits: 3n * MICRO,
          reservedAmountMicrocredits: 3n * MICRO,
          status: 'reserved',
          createdAt: new Date(Date.now() - 3 * 3600 * 1000),
        },
      });
      await sweeper.sweep(new Date(), { reservedTtlMs: 2 * 3600 * 1000, runningTtlMs: 2 * 3600 * 1000 });
      const after = await prisma.billingOrder.findUnique({ where: { id: taskOrder.id } });
      check('任务账单不被代理清扫触碰', after?.status === 'reserved', after?.status);
    }

    /* ── B17. 钱包恒等式：可用余额 = 各批次剩余之和 ── */
    {
      const account = await walletOf(user.id);
      const lots = await prisma.creditLot.findMany({ where: { userId: user.id } });
      const lotSum = lots.reduce((sum, lot) => sum + lot.remainingMicrocredits, 0n);
      check('available == Σ lot.remaining', account.available === lotSum, {
        available: account.available.toString(),
        lotSum: lotSum.toString(),
      });
    }

    /* ── B18. 财务分析口径：实收只认 settled、挂账单列 ── */
    {
      const summary = await finance.summary({});
      const from = new Date(summary.range.from);
      const to = new Date(summary.range.to);
      const rows = await prisma.billingOrder.findMany({ where: { createdAt: { gte: from, lt: to } } });
      const charged = rows.filter((row) => row.status === 'settled').reduce((sum, row) => sum + row.actualAmountMicrocredits, 0n);
      const refunded = rows.reduce((sum, row) => sum + (row.refundedAmountMicrocredits ?? 0n), 0n);
      const outstandingRows = rows.filter((row) => ['reserved', 'running', 'uncertain'].includes(row.status));
      const outstanding = outstandingRows.reduce((sum, row) => sum + (row.reservedAmountMicrocredits ?? 0n), 0n);
      const uncertain = rows.filter((row) => row.status === 'uncertain').length;

      check('财务分析返回区间', typeof summary.range?.from === 'string' && typeof summary.range?.to === 'string', summary.range);
      check('实收 = settled 账单 actualAmount 之和', BigInt(summary.totals.chargedMicrocredits) === charged, {
        api: summary.totals.chargedMicrocredits,
        db: charged.toString(),
      });
      check('已退 = 全部账单 refundedAmount 之和', BigInt(summary.totals.refundedMicrocredits) === refunded, {
        api: summary.totals.refundedMicrocredits,
        db: refunded.toString(),
      });
      check('挂账 = reserved/running/uncertain 的预授权之和', BigInt(summary.totals.outstandingMicrocredits) === outstanding, {
        api: summary.totals.outstandingMicrocredits,
        db: outstanding.toString(),
      });
      check('净收入 = 实收 - 已退', BigInt(summary.totals.netMicrocredits) === charged - refunded, {
        api: summary.totals.netMicrocredits,
        expected: (charged - refunded).toString(),
      });
      check('挂账单数与账单表一致', summary.totals.uncertainOrders === uncertain, {
        api: summary.totals.uncertainOrders,
        db: uncertain,
      });
      check('挂账金额未并入实收（outstanding 已单独列出）', outstanding > 0n && BigInt(summary.totals.chargedMicrocredits) === charged, {
        outstanding: outstanding.toString(),
      });
    }

    /* ── B19. 插件装卸的错误分支与成功路径 ── */
    {
      await expectThrow(
        '非 zip 插件包被拒绝（40001）',
        () => plugins.install(Buffer.from('not a zip at all'), 'admin'),
        /插件包无效/,
        40001,
      );

      const hostManifest = validManifest({ id: `verify-p6-host-${stamp}`, runtime: { backend: 'host:go' } });
      await expectThrow(
        'host: 后端插件被拒绝（40001）',
        () => plugins.install(buildZip([{ name: 'manifest.json', content: Buffer.from(JSON.stringify(hostManifest), 'utf8') }]), 'admin'),
        /不支持 .* 后端/,
        40001,
      );

      const fixtureId = `verify-p6-${stamp}`;
      const protocolId = `verify-p6-protocol-${stamp}`;
      const manifest = validManifest({ id: fixtureId });
      (manifest.contributes as any).providers[0].id = protocolId;
      const zip = buildZip([
        { name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest), 'utf8') },
        { name: 'README.md', content: Buffer.from('P6 验收插件', 'utf8') },
      ]);

      const installed = await plugins.install(zip, 'admin');
      check('上传插件安装成功', installed.id === fixtureId && installed.origin === 'installed', { id: installed.id, origin: installed.origin });
      check('上传插件标记为可卸载', installed.removable === true, installed.removable);
      check('安装目录落在临时目录', path.resolve(manifests.installDirectory()) === path.resolve(PLUGIN_INSTALL_DIR), manifests.installDirectory());

      await expectThrow('重复安装同 id 插件被拒（40909）', () => plugins.install(zip, 'admin'), /已存在|不允许覆盖/, 40909);

      // 仍被渠道模型引用时拒绝卸载：静默失效比报错更难查
      const referencing = await makeChannelModel(channel.id, `verify-plugin-ref-${stamp}`, 1);
      await prisma.channelModel.update({ where: { id: referencing.id }, data: { protocol: protocolId } });
      await expectThrow('协议仍被渠道模型引用时拒绝卸载（40909）', () => plugins.uninstall(fixtureId, 'admin'), /渠道模型/, 40909);
      await prisma.channelModel.deleteMany({ where: { id: referencing.id } });

      const removed = await plugins.uninstall(fixtureId, 'admin');
      check('解除引用后可卸载', removed.removed === true && manifests.get(fixtureId) === null, removed);

      const builtin = (await plugins.list()).items.find((item: any) => item.origin === 'builtin');
      check('内置插件存在（用于卸载拒绝用例）', Boolean(builtin), builtin?.id ?? '');
      if (builtin) {
        await expectThrow('内置插件拒绝卸载（40001）', () => plugins.uninstall(builtin.id, 'admin'), /内置插件不可卸载/, 40001);
      }
      await expectThrow('卸载不存在的插件返回 404', () => plugins.uninstall('no-such-plugin', 'admin'), /插件不存在/, 40400);
    }

    /* ── B20. 入口鉴权与不存在渠道 ── */
    {
      const anon = await call('POST', `/ai/system/${channel.id}/v1/images/generations`, 'invalid-token', {
        body: { model: okKey },
      });
      check('中转需要登录（无效令牌被拒）', anon.status === 401, anon.status);
      check('未认证使用 40101 业务码', anon.code === 40101, anon.code);

      const missing = await call('GET', '/ai/system/no-such-channel/models', token);
      check('不存在的渠道返回 404', missing.status === 404, missing.status);
      check('渠道不存在使用 40401 业务码', missing.code === 40401, missing.code);

      // 保留前缀必须落到业务路由自己的错误上：中转的「渠道不存在」是 40401，
      // 业务路由（任务）用的是自己的 404/403 语义 —— 两者不能混。
      const reserved = await call('GET', '/tasks/not-a-channel', token);
      check('保留前缀不被短路径中转吞掉', reserved.code !== 40401 && !String(reserved.message ?? '').includes('系统渠道'), {
        status: reserved.status,
        code: reserved.code,
      });
      check('保留前缀落到业务路由自身的错误', String(reserved.message ?? '').includes('任务'), reserved.message);
    }
  } finally {
    await cleanup(prisma, created);
    await app.close();
    await mock.close();
    fs.rmSync(PLUGIN_INSTALL_DIR, { recursive: true, force: true });
  }
}

/** 清理夹具：按外键序（SQLite 无级联） */
async function cleanup(
  prisma: any,
  created: { userIds: string[]; channelIds: string[]; channelModelIds: string[]; planIds: string[]; groupIds: string[] },
): Promise<void> {
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
  for (const id of created.groupIds) {
    await prisma.userGroupChannel.deleteMany({ where: { groupId: id } });
    await prisma.userGroup.deleteMany({ where: { id } });
  }
}

async function main(): Promise<void> {
  await runSsrfChecks();
  await runPathChecks();
  await runSlotChecks();
  await runPluginPackageChecks();

  try {
    if (String(process.env.VERIFY_HTTP ?? '1') !== '0') {
      await runHttpChecks();
    }
  } finally {
    // A 段也会建临时插件目录（配置在模块求值期就写入），跳过后必须在这里收尾
    fs.rmSync(PLUGIN_INSTALL_DIR, { recursive: true, force: true });
  }

  console.log(`\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项` : ''}`);
  for (const failure of fails) console.log(`  ✗ ${failure}`);
  if (fails.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(PLUGIN_INSTALL_DIR, { recursive: true, force: true });
  process.exit(1);
});
