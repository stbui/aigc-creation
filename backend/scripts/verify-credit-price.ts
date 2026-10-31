/** 验证后台改价端点: SystemSetting 覆盖 → /capabilities 与生成扣费同步生效 */
process.env.PORT = '3012';
/*
 * 档位跟随调用方（未指定时沿用开发档）。这里不能硬写 development：
 * 否则 `NODE_ENV=test npx ts-node ...` 仍会读写 dev.db，并把开发库的
 * 积分价改成测试值 —— 测试档隔离形同虚设。
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// 本机模型桩是 127.0.0.1：出站层默认拒绝私网，必须在 ConfigModule 装载前放行。
process.env.MODEL_ALLOW_PRIVATE_UPSTREAMS = 'true';
const { NestFactory } = require('@nestjs/core');
// 与 app 使用同一份 src 模块：dist 与 ts-node 编译出的类是两个构造函数，
// 混用会让 app.get(RouteCatalogService) 拿不到实例。
const { AppModule } = require('../src/app.module');
const { ValidationPipe } = require('@nestjs/common');
const { ResponseInterceptor } = require('../src/common/response.interceptor');
const http = require('http');
const BASE = `http://127.0.0.1:${process.env.PORT}/api/v1`;

async function call(method: string, path: string, token?: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let j: any; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0,150) }; }
  return { status: res.status, ...j };
}
let pass=0, fail=0;
function check(n: string, ok: boolean, d='') { if(ok){pass++;console.log(`  PASS  ${n}${d?' — '+d:''}`);} else {fail++;console.log(`  FAIL  ${n}${d?' — '+d:''}`);} }

(async () => {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT), '127.0.0.1');

  const prisma = app.get(require('../src/prisma/prisma.service').PrismaService);

  console.log('【改价前基线】');
  const caps0 = await call('GET', '/capabilities');
  const expand0 = caps0.data.items.find((c: any) => c.id === 'expand');
  check('expand 初始价 = registry 默认', expand0.creditCost === 5, `当前 ${expand0.creditCost}`);

  /*
   * ⚠ 必须用 seed:admin 建的后台账号 —— C 端注册用户的 role 是 user,
   * 会被 AdminGuard 拦成 403, 表现为「改价失败」, 实则是身份不对。
   * development/test 使用统一预设，production 需通过环境变量提供 seed 密码。
   */
  const { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } = require('./admin-credentials').getAdminCredentials();
  if (!ADMIN_PASSWORD) {
    console.error('  缺少 ADMIN_PASSWORD: production 环境请先 npm run seed:admin，再传入打印的一次性密码。');
    await app.close();
    process.exit(1);
  }
  const admin = await call('POST', '/auth/login', null, {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  const AT = admin.data?.accessToken;
  check('管理员登录成功', !!AT, admin.data?.user?.email ?? admin.message);
  if (!AT) {
    console.error('  ⚠ 管理员登录失败, 后续改价断言无法进行。请先跑 npm run seed:admin');
    await app.close();
    process.exit(1);
  }

  console.log('\n【C 端无权限改价 → 401】');
  const noAuth = await call('PUT', '/admin/credit-prices', null, { items: [{ capabilityId: 'expand', cost: 99 }] });
  check('未登录改价被拒', noAuth.status === 401 || noAuth.status === 403, `HTTP ${noAuth.status}`);

  console.log('\n【非法参数被拒】');
  const badCost = await call('PUT', '/admin/credit-prices', AT, { items: [{ capabilityId: 'expand', cost: -5 }] });
  check('负数消耗价被拒', badCost.status === 400, `HTTP ${badCost.status}`);
  const badCap = await call('PUT', '/admin/credit-prices', AT, { items: [{ capabilityId: 'no_such_cap', cost: 5 }] });
  check('未知能力 id 被拒', badCap.status === 400, `HTTP ${badCap.status}`);

  console.log('\n【改价生效】');
  const upd = await call('PUT', '/admin/credit-prices', AT, { items: [{ capabilityId: 'expand', cost: 77 }] });
  check('改价成功', upd.status === 200 || upd.status === 201, JSON.stringify(upd.data ?? upd.message).slice(0,80));

  // 缓存 3s TTL, 但改价会 invalidate(); 立即验证
  await new Promise(r => setTimeout(r, 500));
  const caps1 = await call('GET', '/capabilities');
  const expand1 = caps1.data.items.find((c: any) => c.id === 'expand');
  check('/capabilities 立即下发新价', expand1.creditCost === 77, `下发 ${expand1.creditCost}`);
  check('未改的能力不受影响', caps1.data.items.find((c: any) => c.id === 'matting').creditCost === 0, 'matting=0');

  console.log('\n【改价同步影响实际扣费】');
  const bcrypt = require('bcryptjs');
  const email = `price-${Date.now()}@test.com`;
  const u = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('test123456',10), name:'改价测试' } });
  const T = (await call('POST','/auth/login',null,{email,password:'test123456'})).data.accessToken;
  // 500 积分 = 5e8 微积分；批次与账户必须同时建，否则余额接口读不到
  const seedAmount = 500n * 1_000_000n;
  const seedLot = await prisma.creditLot.create({ data: { userId: u.id, source:'grant', totalMicrocredits: seedAmount, remainingMicrocredits: seedAmount, expireAt: null } });
  await prisma.creditAccount.create({ data: { userId: u.id, availableMicrocredits: seedAmount } });
  await prisma.creditLedgerEntry.create({
    data: {
      userId: u.id,
      type: 'grant',
      amountMicrocredits: seedAmount,
      availableDeltaMicrocredits: seedAmount,
      availableAfterMicrocredits: seedAmount,
      reservedAfterMicrocredits: 0n,
      lotId: seedLot.id,
      note: '改价测试',
    },
  });

  const projectId = (await call('POST','/projects',T,{ name:'改价项目' })).data?.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const fd = new FormData();
  fd.append('file', new Blob([png],{type:'image/png'}), 'price.png');
  fd.append('projectId', projectId);
  const assetId = (await (await fetch(`${BASE}/assets/upload`,{method:'POST',headers:{Authorization:`Bearer ${T}`},body:fd})).json()).data?.id;
  check('素材已上传', !!assetId, assetId);

  /*
   * 新模型层夹具：建任务必须带前台模型 id，且模型要有可用线路。
   * 这里起一个本机 OpenAI 兼容桩（成功回 base64 PNG），走生产同一条
   * ProtocolExecutor → 出站安全链路；协议填 provider id `openai-image`。
   */
  const smokePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const modelServer = http.createServer((req: any, res: any) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: smokePng.toString('base64') }] }));
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const modelPort = modelServer.address().port;

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
  const channel = await prisma.modelChannel.create({
    data: { userId: '', scope: 'system', enabled: true, name: `改价验证渠道-${Date.now()}`, baseUrl: `http://127.0.0.1:${modelPort}`, apiKey: 'smoke-token', sortOrder: -100 },
  });
  const channelModel = await prisma.channelModel.create({
    data: {
      channelId: channel.id,
      modelKey: 'price-image-model',
      activeKey: 'price-image-model',
      providerModelKey: 'price-image-model',
      displayName: '改价验证模型桩',
      capability: 'image',
      protocol: 'openai-image',
      billingMode: 'fixed_request',
      capabilityConfigJson: JSON.stringify(IMAGE_CONFIG),
      enabled: true,
      priceConfigured: false,
    },
  });
  const logicalModel = await prisma.logicalModel.create({
    data: {
      code: `price-smoke-${Date.now()}`,
      activeKey: `price-smoke-${Date.now()}`,
      name: '改价验证模型',
      capability: 'expand',
      enabled: true,
      pricePolicy: 'unified',
      billingMode: 'fixed_request',
      unitPriceMicrocredits: 77n * 1_000_000n,
    },
  });
  const revision = await prisma.logicalModelRevision.create({
    data: {
      logicalModelId: logicalModel.id,
      version: 1,
      capabilitySpecJson: JSON.stringify(
        require('../src/model/intent/capability-spec').capabilitySpecFromModelCapabilityConfig(IMAGE_CONFIG, 'image'),
      ),
      defaultOptionsJson: '{}',
    },
  });
  await prisma.logicalModelRoute.create({
    data: { logicalModelRevisionId: revision.id, channelModelId: channelModel.id, priority: 0, weight: 100, enabled: true },
  });
  await prisma.logicalModel.update({ where: { id: logicalModel.id }, data: { activeRevisionId: revision.id, revisionSequence: 1 } });
  app.get(require('../src/model/catalog/route-catalog.service').RouteCatalogService).invalidateLocal();

  const gen = await call('POST','/generate',T,{ projectId, capability:'expand', logicalModelId: logicalModel.id, inputAssetIds:[assetId], params:{ratio:'1:1'} });
  check('按新价 77 扣费', gen.data?.creditCost === 77, `实际扣 ${gen.data?.creditCost}`);
  const bal = (await call('GET','/credits/balance',T)).data?.balance;
  check('余额 500-77=423', bal === 423, `余额 ${bal}`);

  console.log('\n【回落默认值】');
  const rst = await call('POST','/admin/credit-prices/expand/reset', AT);
  check('回落成功', rst.status === 200 || rst.status === 201, `新价 ${rst.data?.cost}`);
  await new Promise(r => setTimeout(r, 500));
  const caps2 = await call('GET','/capabilities');
  check('回落后 /capabilities 恢复 5', caps2.data.items.find((c:any)=>c.id==='expand').creditCost === 5,
    `当前 ${caps2.data.items.find((c:any)=>c.id==='expand').creditCost}`);

  console.log('\n【列表带来源标记】');
  const list = await call('GET','/admin/credit-prices', AT);
  const item = Array.isArray(list.data) ? list.data.find((x:any)=>x.capabilityId==='matting') : null;
  check('列表返回 source 字段', !!item && ['setting','registry'].includes(item.source), `source=${item?.source}`);
  check('未覆盖项 source=registry', item?.source === 'registry', `source=${item?.source}`);

  // 清理：任务 → 素材 → 项目 → 账号 → 模型夹具 → 系统设置覆盖
  await prisma.generationTask.deleteMany({ where: { ownerId: u.id } });
  await prisma.asset.deleteMany({ where: { ownerId: u.id } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await require('./credit-fixture').clearCredits(prisma, u.id);
  await prisma.user.delete({ where: { id: u.id } });
  await prisma.logicalModelRoute.deleteMany({ where: { logicalModelRevisionId: revision.id } });
  await prisma.logicalModelRevision.deleteMany({ where: { logicalModelId: logicalModel.id } });
  await prisma.logicalModel.deleteMany({ where: { id: logicalModel.id } });
  await prisma.channelModel.deleteMany({ where: { id: channelModel.id } });
  await prisma.modelChannel.deleteMany({ where: { id: channel.id } });
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'creditPrice.' } } });
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));

  console.log(`\n${'='.repeat(54)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(54));
  await app.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('[验证] 异常:', e); process.exit(1); });
