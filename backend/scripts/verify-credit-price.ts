/** 验证后台改价端点: SystemSetting 覆盖 → /capabilities 与生成扣费同步生效 */
process.env.PORT = '3012';
/*
 * 档位跟随调用方（未指定时沿用开发档）。这里不能硬写 development：
 * 否则 `NODE_ENV=test npx ts-node ...` 仍会读写 dev.db，并把开发库的
 * 积分价改成测试值 —— 测试档隔离形同虚设。
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { ValidationPipe } = require('@nestjs/common');
const { ResponseInterceptor } = require('../dist/common/response.interceptor');
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

  const prisma = app.get(require('../dist/prisma/prisma.service').PrismaService);

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
  await prisma.creditLot.create({ data: { userId: u.id, source:'grant', totalCredits: 500, remainingCredits: 500, expireAt: null } });
  await prisma.creditLedger.create({ data: { userId: u.id, type:'grant', amount:500, balanceAfter:500, reason:'改价测试' } });

  const projectId = (await call('POST','/projects',T,{ name:'改价项目' })).data?.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const fd = new FormData();
  fd.append('file', new Blob([png],{type:'image/png'}), 'price.png');
  fd.append('projectId', projectId);
  const assetId = (await (await fetch(`${BASE}/assets/upload`,{method:'POST',headers:{Authorization:`Bearer ${T}`},body:fd})).json()).data?.id;
  check('素材已上传', !!assetId, assetId);

  const gen = await call('POST','/generate',T,{ projectId, capability:'expand', inputAssetIds:[assetId], params:{ratio:'1:1'} });
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

  // 清理
  await prisma.generationTask.deleteMany({ where: { ownerId: u.id } });
  await prisma.asset.deleteMany({ where: { ownerId: u.id } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.creditLedger.deleteMany({ where: { userId: u.id } });
  await prisma.creditLot.deleteMany({ where: { userId: u.id } });
  await prisma.user.delete({ where: { id: u.id } });
  await prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'creditPrice.' } } });

  console.log(`\n${'='.repeat(54)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(54));
  await app.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('[验证] 异常:', e); process.exit(1); });
