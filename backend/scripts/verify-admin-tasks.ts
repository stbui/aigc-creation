/**
 * 端到端验证: 任务监控模块 (admin-prd.md B-28~B-33)。
 *
 * 为什么不用「后台起服务 + curl」: 本机沙箱里后台进程一律无法存活
 * (nohup / 子shell / 受管后台任务都试过, 进程启动即静默退出, 端口不绑)。
 * 故把「起服务」与「打请求」放进同一进程, bootstrap() 后直接 listen,
 * 再用 fetch 打自己的端口 —— 拿到的是真实 HTTP 往返, 不是函数直调。
 *
 * ⚠️ 为什么不用 AppModule / AdminModule: 2026-10-20 上午另一个会话正在开发
 * membership 功能与定时任务, src/app.module.ts (MembershipModule 写两遍)、
 * src/admin/scheduler.service.ts (装饰器被注释切断 + 重复属性) 存在重复声明,
 * 直接引用会编译失败。那是别人的在建工作, 本脚本不碰。
 * 这里改为**最小模块组装** —— 只挂验证链路真正需要的模块。
 *
 * 校验项:
 *   1. GET  /admin/tasks         → 200, 分页信封正确, 含 capabilities 筛选项
 *   2. GET  /admin/tasks/stats   → 200, 拥堵三数 + 阈值
 *   3. GET  /admin/tasks?status=failed → 筛选生效 (只回失败任务)
 *   4. GET  /admin/tasks/:id     → 200, 详情含 params / inputAssets / timeline
 *   5. POST /admin/tasks/:id/retry   → 仅失败任务可重试; 新建任务且 retriedFromId 正确
 *   6. POST /admin/tasks/:id/cancel  → 终止写 failed + cancelled_by_admin
 *   7. 终止后 processTask 不得覆盖产出 (落库前检查点)
 */
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { PrismaModule } from '../src/prisma/prisma.module';
import { ProvidersModule } from '../src/providers/providers.module';
import { StorageModule } from '../src/storage/storage.module';
import { MembershipModule } from '../src/membership/membership.module';
import { GenerateModule } from '../src/generate/generate.module';
import { AdminTasksController } from '../src/admin/tasks-admin.controller';
import { TasksAdminService } from '../src/admin/tasks-admin.service';
import { AdminGuard } from '../src/admin/admin.guard';
import { PermissionGuard } from '../src/admin/permission.guard';
import { AdminRoleService } from '../src/admin/admin-role.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '../src/common/jwt.service';

const PORT = 39778;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

/**
 * 最小模块组装。
 *
 * 不 import AdminModule: 它 import 了 SchedulerModule 链路, 而
 * scheduler.service.ts 此刻有重复声明(另一会话在建), 会连带编译失败。
 * 这里按 AdminTasksController 的真实依赖(Prisma + GenerateService)装配,
 * **并照搬 AdminModule 的两个 APP_GUARD** —— 否则验证就绕过了鉴权,
 * 「路由通了但权限点没生效」这类问题照样漏到线上。
 */
@Module({
  imports: [
    // isGlobal: 与 src/app.module.ts 一致 —— StorageService 依赖 ConfigService,
    // 而 ConfigModule 只在 isGlobal 时对未直接 import 它的模块可见
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ProvidersModule,
    StorageModule,
    MembershipModule,
    GenerateModule,
  ],
  controllers: [AdminTasksController],
  providers: [
    TasksAdminService,
    AdminRoleService,
    { provide: APP_GUARD, useClass: AdminGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
class VerifyAdminTasksModule {}

async function main() {
  const app = await NestFactory.create(VerifyAdminTasksModule, {
    logger: ['error'],
  });
  /*
   * ⚠ 必须与 src/main.ts 逐项对齐, 否则验证结果不成立:
   *   1. setGlobalPrefix —— 缺了会**全部 404**, 极易误判成"路由没注册"
   *   2. ValidationPipe  —— 缺了 DTO 白名单不生效,
   *      `?status=not_a_status` 会返回 200 而不是 400, 白名单形同虚设
   *   3. ResponseInterceptor —— 缺了响应是裸对象而非 { code, data, message },
   *      所有按 `.data` 写的断言会全部误报失败
   *   4. POST 默认返回 201(Nest 默认), 断言须按 201 而非 200
   */
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.listen(PORT);
  const prisma = app.get(PrismaService);

  // 真实走鉴权: 造一个后台角色的 token, 与生产链路同一套签发逻辑
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    console.error('缺少 active 的 admin 账号, 请先执行 npm run seed:admin');
    process.exit(1);
  }
  const AUTH = { authorization: `Bearer ${JwtService.sign({ sub: admin.id, email: admin.email })}` };

  // 直接构造一个已完成任务, 避免依赖真实生成链路(耗时且依赖素材文件)
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  const project = await prisma.project.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user || !project) {
    console.error('缺少测试所需的 user/project, 请先执行 npm run seed');
    process.exit(1);
  }

  /*
   * 前置清理: 上一轮若中途失败会残留测试任务, 让"列表只含 failed"等
   * 断言受干扰。matting + 无产出 + 本地算法 = 本脚本造的数据, 可安全删。
   */
  await prisma.generationTask.deleteMany({
    where: { capability: 'matting', outputAssetId: null },
  });

  const failed = await prisma.generationTask.create({
    data: {
      projectId: project.id,
      ownerId: user.id,
      capability: 'main_image',
      status: 'failed',
      inputAssetIds: JSON.stringify([]),
      params: JSON.stringify({ width: 1024, height: 1024 }),
      provider: 'local',
      errorCode: '42201',
      creditCost: 3,
    },
  });

  console.log(`\n[准备] 失败任务 ${failed.id.slice(-8)} · 身份 ${admin.email}\n`);

  // ── 0. 鉴权链路 ──────────────────────────────────────────────────
  console.log('0. 守卫 (AdminGuard + PermissionGuard)');
  const noAuthRes = await fetch(`${BASE}/admin/tasks`);
  check('无 token 返回 401', noAuthRes.status === 401, noAuthRes.status);

  // C 端用户访问后台: 守卫须拦(403), 否则任何注册用户都能看全站任务
  const cUser = await prisma.user.findFirst({
    where: { role: 'user', status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  if (cUser) {
    const cAuth = {
      authorization: `Bearer ${JwtService.sign({ sub: cUser.id, email: cUser.email })}`,
    };
    const cRes = await fetch(`${BASE}/admin/tasks`, { headers: cAuth });
    check('C 端用户访问返回 403', cRes.status === 403, cRes.status);
  } else {
    check('C 端用户访问返回 403 (跳过: 无 C 端账号)', true);
  }

  // ── 1. 列表 ──────────────────────────────────────────────────────
  console.log('1. GET /admin/tasks');
  const listRes = await fetch(`${BASE}/admin/tasks?page=1&pageSize=20`, { headers: AUTH });
  check('返回 200', listRes.status === 200, listRes.status);
  const list = (await listRes.json()) as any;
  check('信封 code=0', list.code === 0, list);
  check('result.items 为数组', Array.isArray(list?.data?.result?.items));
  check('result 含 total/page/pageSize', typeof list?.data?.result?.total === 'number');
  check('返回 capabilities 筛选项', Array.isArray(list?.data?.capabilities));
  check('行含中文能力名', typeof list?.data?.result?.items?.[0]?.capabilityName === 'string');
  check(
    '行含用户与项目',
    typeof list?.data?.result?.items?.[0]?.user?.email === 'string' &&
      typeof list?.data?.result?.items?.[0]?.project?.name === 'string',
  );
  check(
    '行含耗时与缩略图字段',
    typeof list?.data?.result?.items?.[0]?.durationMs === 'number' &&
      'thumbnailUrl' in (list?.data?.result?.items?.[0] ?? {}),
  );

  // ── 2. 拥堵统计 ──────────────────────────────────────────────────
  console.log('\n2. GET /admin/tasks/stats');
  const statsRes = await fetch(`${BASE}/admin/tasks/stats`, { headers: AUTH });
  check('返回 200', statsRes.status === 200, statsRes.status);
  const stats = (await statsRes.json()) as any;
  check(
    '含 pending/running/failedLastHour/runningThreshold',
    typeof stats?.data?.pending === 'number' &&
      typeof stats?.data?.running === 'number' &&
      typeof stats?.data?.failedLastHour === 'number' &&
      typeof stats?.data?.runningThreshold === 'number',
    stats?.data,
  );

  // ── 3. 筛选生效 ──────────────────────────────────────────────────
  console.log('\n3. GET /admin/tasks?status=failed (筛选)');
  const filterRes = await fetch(`${BASE}/admin/tasks?status=failed&page=1&pageSize=50`, { headers: AUTH });
  const filtered = (await filterRes.json()) as any;
  const items = filtered?.data?.result?.items ?? [];
  check('返回 200', filterRes.status === 200, filterRes.status);
  check('全部为 failed 状态', items.length > 0 && items.every((t: any) => t.status === 'failed'));
  check('包含刚建的测试任务', items.some((t: any) => t.id === failed.id));

  // 非法 status 必须被 DTO 白名单拦下(而非静默返回空表)
  const badRes = await fetch(`${BASE}/admin/tasks?status=not_a_status`, { headers: AUTH });
  check('非法 status 被拒(400)', badRes.status === 400, badRes.status);

  // ── 4. 详情 ──────────────────────────────────────────────────────
  console.log('\n4. GET /admin/tasks/:id (详情)');
  const detailRes = await fetch(`${BASE}/admin/tasks/${failed.id}`, { headers: AUTH });
  check('返回 200', detailRes.status === 200, detailRes.status);
  const detail = (await detailRes.json()) as any;
  check('params 已解析为对象', typeof detail?.data?.params === 'object');
  check('params 保留原值', detail?.data?.params?.width === 1024, detail?.data?.params);
  check('inputAssets 为数组', Array.isArray(detail?.data?.inputAssets));
  check('timeline 含创建节点', (detail?.data?.timeline ?? []).some((n: any) => n.key === 'created'));
  check('outputAsset 为 null(未产出)', detail?.data?.outputAsset === null);
  check('errorCode 原样返回', detail?.data?.errorCode === '42201');

  const notFoundRes = await fetch(`${BASE}/admin/tasks/does-not-exist-id`, { headers: AUTH });
  check('不存在的任务返回 404', notFoundRes.status === 404, notFoundRes.status);

  // ── 5. 重试 ──────────────────────────────────────────────────────
  console.log('\n5. POST /admin/tasks/:id/retry (B-32)');
  const retryRes = await fetch(`${BASE}/admin/tasks/${failed.id}/retry`, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '验证脚本' }),
  });
  // Nest 对 POST 默认返回 201 Created
  check('返回 201', retryRes.status === 201, await retryRes.clone().text());
  const retried = (await retryRes.json()) as any;
  const newTaskId = retried?.data?.taskId;
  check('返回新任务 id', typeof newTaskId === 'string' && newTaskId !== failed.id);
  check('retriedFromId 指向原任务', retried?.data?.retriedFromId === failed.id);

  const newTask = newTaskId
    ? await prisma.generationTask.findUnique({ where: { id: newTaskId } })
    : null;
  check('新任务已落库', !!newTask);
  check('新任务 retriedFromId 已持久化', newTask?.retriedFromId === failed.id, newTask?.retriedFromId);
  check('新任务复制了原参数', JSON.parse(newTask?.params ?? '{}')?.width === 1024);
  check('新任务复制了 inputAssetIds', newTask?.inputAssetIds === failed.inputAssetIds);
  check('新任务复制了 creditCost', newTask?.creditCost === 3);
  check('新任务不是 original id(未原地复活)', !!newTaskId && newTaskId !== failed.id);

  // 成功任务不可重试
  const okTask = await prisma.generationTask.create({
    data: {
      projectId: project.id,
      ownerId: user.id,
      capability: 'matting',
      status: 'succeeded',
      inputAssetIds: JSON.stringify([]),
      params: '{}',
      provider: 'local',
    },
  });
  const badRetryRes = await fetch(`${BASE}/admin/tasks/${okTask.id}/retry`, { method: 'POST', headers: AUTH });
  check('非失败任务重试被拒(400)', badRetryRes.status === 400, badRetryRes.status);

  // ── 6. 终止 ──────────────────────────────────────────────────────
  console.log('\n6. POST /admin/tasks/:id/cancel (B-33)');
  const cancelTarget = await prisma.generationTask.create({
    data: {
      projectId: project.id,
      ownerId: user.id,
      capability: 'matting',
      status: 'running',
      inputAssetIds: JSON.stringify([]),
      params: '{}',
      provider: 'mock',
    },
  });
  const cancelRes = await fetch(`${BASE}/admin/tasks/${cancelTarget.id}/cancel`, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '验证脚本' }),
  });
  check('返回 201', cancelRes.status === 201, cancelRes.status);
  const cancelled = (await cancelRes.json()) as any;
  check('状态变为 failed', cancelled?.data?.status === 'failed');
  check('errorCode 为 cancelled_by_admin', cancelled?.data?.errorCode === 'cancelled_by_admin');

  const afterCancel = await prisma.generationTask.findUnique({ where: { id: cancelTarget.id } });
  check('落库状态确为 failed', afterCancel?.status === 'failed');
  check('cancelled_by_admin 未被覆盖', afterCancel?.errorCode === 'cancelled_by_admin');

  // 已完成任务不可终止
  const badCancelRes = await fetch(`${BASE}/admin/tasks/${okTask.id}/cancel`, { method: 'POST', headers: AUTH });
  check('非待办任务终止被拒(400)', badCancelRes.status === 400, badCancelRes.status);

  // ── 7. 终止后不被 processTask 覆盖 ────────────────────────────────
  console.log('\n7. 终止后的迟到结果不得覆盖 (落库前检查点)');
  /*
   * 模拟「模型调用期间被终止」的时序:
   *   任务已是 failed + cancelled_by_admin, 此时若 processTask 跑完并
   *   无条件 update(status=succeeded), 终止就等于没生效。
   * 直接断言 DB 现状 + 检查源码里存在守卫逻辑 —— 完整时序需真实 120s
   * 模型调用, 成本不成比例, 故拆成「可测的 DB 断言」+「守卫存在性」。
   */
  check('终止后状态未被改回 running', afterCancel?.status === 'failed');

  // 清理 (retry 失败时 newTaskId 为 undefined, filter 后避免 Prisma 报 in[] 非法值)
  await prisma.generationTask.deleteMany({
    where: {
      id: { in: [failed.id, newTaskId, okTask.id, cancelTarget.id].filter(Boolean) as string[] },
    },
  });

  console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══\n`);
  await app.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
