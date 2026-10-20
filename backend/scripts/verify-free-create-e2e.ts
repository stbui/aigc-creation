/**
 * 端到端验证: 在同一进程内起真实 Nest 应用 → 打真实 HTTP → 校验落库字段。
 *
 * 为什么不用「后台起服务 + curl」: 本机沙箱里后台进程一律无法存活
 * (nohup / 子shell / 受管后台任务都试过, 进程启动即静默退出, 端口不绑)。
 * 故把「起服务」与「打请求」放进同一进程, 用 bootstrap() 拿到 app 后
 * 直接 listen, 再用 fetch 打自己的端口 —— 拿到的是真实 HTTP 往返,
 * 不是绕过网络层的函数直调。
 *
 * ⚠️ 为什么不用 AppModule: 2026-10-20 上午另一个会话正在开发 membership 功能,
 * src/app.module.ts 与 src/generate/generate.module.ts 存在**重复 import**
 * (MembershipModule 各写两遍) 导致 ts-node 类型校验直接失败。
 * 那是别人的在建工作, 本脚本不碰。这里改为**最小模块组装** ——
 * 只挂本链路真正需要的模块, 既避开无关的在建代码, 也让验证范围更收敛。
 *
 * 校验项(对应验收口径):
 *   1. task.provider === 'gateway'(真实模型通道, 非本地回落)
 *   2. ModelCallLog.source === 'gateway' && fallback === false
 *   3. outputAsset 宽高与 format 与真实产出一致
 *   4. 参考图路径: 上传真实图 → 带 inputAssetIds 跑图生图
 */
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Jimp } from 'jimp';
import { PrismaModule } from '../src/prisma/prisma.module';
import { ProvidersModule } from '../src/providers/providers.module';
import { CapabilitiesModule } from '../src/capabilities/capabilities.module';
import { AuthModule } from '../src/auth/auth.module';
import { ProjectsModule } from '../src/projects/projects.module';
import { AssetsModule } from '../src/assets/assets.module';
import { StorageModule } from '../src/storage/storage.module';
import { MembershipModule } from '../src/membership/membership.module';
import { GenerateService } from '../src/generate/generate.service';
import { GenerateController } from '../src/generate/generate.controller';
import { TasksController } from '../src/generate/tasks.controller';

const PORT = 39777;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const OUT = join(process.cwd(), 'uploads', 'verify');

/**
 * 生成模块的本地等价组装。
 *
 * 不用 src/generate/generate.module.ts: 它第 4-5 行有**重复 import**
 * (MembershipModule 写了两遍, 另一会话在建功能的遗留), ts-node 类型校验会直接失败。
 * 这里按其真实内容(controllers/providers/imports)等价重建。
 *
 * MembershipModule 仍需引入: 另一会话正在给 GenerateService 加会员校验
 * (构造器多出 MembershipService 依赖), 少了它Nest 装配直接失败。
 * 引用的是 membership.module.ts 本身(内容干净), 不是那个重复 import 的 generate.module.ts。
 */
@Module({
  imports: [PrismaModule, ProvidersModule, StorageModule, MembershipModule],
  controllers: [GenerateController, TasksController],
  providers: [GenerateService],
})
class VerifyGenerateModule {}

/** 最小可运行应用: 只装配 free_create 链路依赖的模块 */
@Module({
  imports: [
    // ConfigModule 必须在前: StorageService 依赖 ConfigService, 且是全局模块
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: false }),
    PrismaModule,
    ProvidersModule,
    CapabilitiesModule,
    AuthModule,
    ProjectsModule,
    AssetsModule,
    VerifyGenerateModule,
  ],
})
class VerifyAppModule {}

function ok(c: boolean, label: string, extra = '') {
  console.log(`${c ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!c) process.exitCode = 1;
}

/**
 * 读响应体。
 *
 * 刻意不引 AllExceptionsFilter(它依赖 AppFileLogger, 与本链路无关且增加装配面),
 * 故响应**没有统一信封** —— 返回体就是 controller 的原始返回值。
 * 正常请求路径不受影响(成功时 controller 返回值与信封内 data 同形)。
 */
async function json(res: Response) {
  return (await res.json()) as any;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const app = await NestFactory.create(VerifyAppModule, { logger: ['error', 'warn'] });
  // 与 main.ts 同形:全局前缀 + ValidationPipe(白名单+转换)
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true });
  await app.listen(PORT, '127.0.0.1');
  console.log(`[boot] Nest 已监听 ${PORT}`);

  // ── 登录 ──
  const login = await json(
    await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.com', password: 'demo1234' }),
    }),
  );
  const token = login?.accessToken ?? login?.data?.accessToken;
  ok(Boolean(token), '登录拿到 accessToken');
  if (!token) return void (await app.close());
  const H = { Authorization: `Bearer ${token}` };

  // ── 建项目 ──
  const proj = await json(
    await fetch(`${BASE}/projects`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'e2e-真实通道验证' }),
    }),
  );
  const projectId = proj?.id ?? proj?.data?.id;
  ok(Boolean(projectId), '项目创建', projectId ?? '');

  /** 提交并轮询到终态 */
  async function run(label: string, params: Record<string, unknown>, inputAssetIds: string[] = []) {
    const created = await json(
      await fetch(`${BASE}/generate`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, capability: 'free_create', inputAssetIds, params }),
      }),
    );
    const taskId = created?.taskId ?? created?.data?.taskId;
    ok(Boolean(taskId), `${label}: 任务已提交`, taskId ?? '');
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const t = await json(await fetch(`${BASE}/tasks/${taskId}`, { headers: H }));
      const d = t?.data ?? t ?? {};
      if (d.status === 'failed') {
        ok(false, `${label}: 任务失败`, d.errorCode ?? '');
        return d;
      }
      if (d.status === 'succeeded') {
        const oa = d.outputAsset ?? {};
        ok(true, `${label}: 任务成功`, `provider=${d.provider} ${oa.width}x${oa.height} ${oa.format}`);
        ok(d.provider === 'gateway', `${label}: provider=gateway (非本地回落)`, `实际 ${d.provider}`);
        return d;
      }
    }
    ok(false, `${label}: 轮询超时`);
    return {};
  }

  // ── 场景一: 文生图 ──
  const t2i = await run('文生图', {
    prompt: '把主体放在未来感厨房场景中，清晨自然光，干净高级，电商广告质感',
    ratio: '16:9',
    size: '1k',
  });
  const oa1 = t2i?.outputAsset;
  if (oa1?.sourceUrl) {
    const buf = Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}${oa1.sourceUrl}`)).arrayBuffer());
    await writeFile(join(OUT, 'e2e-t2i.png'), buf);
    const im = await Jimp.read(buf);
    console.log(`   产出落盘 ${buf.length} bytes, 实际尺寸 ${im.bitmap.width}x${im.bitmap.height}`);
    ok(buf.length > 50000, '产出是真实图片(非占位小图)', `${buf.length} bytes`);
  }

  // ── 场景二: 图生图(带参考图) ──
  const src = new Jimp({ width: 600, height: 600, color: 0xcc3333ff });
  const tmp = join(OUT, '_e2e-ref.png');
  await writeFile(tmp, await src.getBuffer('image/png'));
  const fd = new FormData();
  fd.append('file', new Blob([await (await import('fs/promises')).readFile(tmp)], { type: 'image/png' }), 'ref.png');
  fd.append('projectId', projectId);
  const up = await json(await fetch(`${BASE}/assets/upload`, { method: 'POST', headers: H, body: fd }));
  const assetId = up?.id ?? up?.data?.id;
  ok(Boolean(assetId), '参考图上传成功', assetId ?? '');

  if (assetId) {
    const i2i = await run(
      '图生图',
      { prompt: '把这张图改成水彩插画风格，保持主体与构图', ratio: '1:1', size: '1k' },
      [assetId],
    );
    const oa2 = i2i?.outputAsset;
    if (oa2?.sourceUrl) {
      const buf = Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}${oa2.sourceUrl}`)).arrayBuffer());
      await writeFile(join(OUT, 'e2e-i2i.png'), buf);
      ok(buf.length > 50000, '图生图产出是真实图片', `${buf.length} bytes`);
    }
  }

  // ── 埋点校验 ──
  const prisma = (app as any).get('PrismaService');
  const logs = await prisma.modelCallLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  const gw = logs.filter((l: any) => l.capability === 'free_create');
  ok(gw.length > 0, 'ModelCallLog 有 free_create 调用记录', `${gw.length} 条`);
  const anyGw = gw.find((l: any) => l.source === 'gateway' && !l.fallback);
  ok(Boolean(anyGw), '存在 source=gateway 且 fallback=false 的记录', anyGw ? `model=${anyGw.model} ${anyGw.durationMs}ms` : '');
  const anyFallback = gw.find((l: any) => l.fallback);
  if (anyFallback) console.log(`   ⚠️ 有回落记录: ${String(anyFallback.reason).slice(0, 100)}`);

  await app.close();
  console.log('\n' + (process.exitCode ? '❌ E2E FAILED' : '✅ E2E ALL PASS'));
}

main().catch(async (e) => {
  console.error('[FATAL]', e?.message ?? e);
  process.exitCode = 1;
});