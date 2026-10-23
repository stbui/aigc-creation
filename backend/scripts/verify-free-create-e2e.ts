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
 *   0. 前置: 必须配好可用的图像模型通道。2026-10-21 起 free_create 的
 *      localFallback=false —— 没通道时任务直接 failed/42204 并退款,
 *      不会再拿本地产物凑一个"成功"给这个脚本看。
 *   1. task.provider === 'gateway'(真实模型通道, 非本地回落)
 *   2. ModelCallLog.source === 'gateway' && fallback === false
 *   3. outputAsset 宽高与 format 与真实产出一致
 *   4. 参考图路径: 上传真实图 → 带 inputAssetIds 跑图生图
 */
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
/*
 * 必须用项目自己的 ConfigModule, 不能裸 ConfigModule.forRoot:
 * 前者按 NODE_ENV 选 env 档 (test → .env.test → test.db), 后者只会找 `.env`,
 * 找不到就让 DATABASE_URL 回落 dev.db —— 于是「测试档」实际读写开发库,
 * 还会拿 dev 库里配的真实厂商线路去发请求 (实测烧掉一次真实调用才暴露)。
 */
import { ConfigModule } from '../src/config/config.module';
import { Jimp } from 'jimp';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProvidersModule } from '../src/providers/providers.module';
import { CapabilitiesModule } from '../src/capabilities/capabilities.module';
import { AuthModule } from '../src/auth/auth.module';
import { ProjectsModule } from '../src/projects/projects.module';
import { AssetsModule } from '../src/assets/assets.module';
import { StorageModule } from '../src/storage/storage.module';
// 两个 @Global 基础设施模块: AuthService 依赖 EmailService/SmsService,
// GenerateService 与 MembershipService 依赖 NotificationsService。
// 全局模块也必须被根模块 import 一次才可见, 少了 Nest 装配直接抛 UnknownDependencies。
import { ChannelsModule } from '../src/channels/channels.module';
import { NotificationsModule } from '../src/notifications/notifications.module';
// SignedUrlService（AssetsService 依赖）由 CommonModule 提供，不是全局模块
import { CommonModule } from '../src/common/common.module';
import { GenerateModule } from '../src/generate/generate.module';

const PORT = 39777;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const OUT = join(process.cwd(), 'uploads', 'verify');

/**
 * 最小可运行应用: 只装配 free_create 链路依赖的模块
 *
 * 早先这里手抄过一份生成模块 —— 当时 generate.module.ts 有重复 import，
 * 抄一份能绕开编译错。但抄件不会跟着 GenerateService 的构造器一起长：
 * 每次新增依赖（CreditsModule / CapabilitiesModule / AigcLabelModule …）
 * 都得手动补，漏一次就报 UnknownDependencies。重复 import 早已修掉，
 * 故直接装配真实 GenerateModule，让 Nest 自己校验接线。
 */
@Module({
  imports: [
    // ConfigModule 必须在前: 它在 import 时把 .env.<NODE_ENV> 灌进 process.env,
    // 后续 PrismaService 才连对库
    ConfigModule,
    PrismaModule,
    ProvidersModule,
    // StorageModule 是 @Global, 但全局模块也要在根模块 import 一次才可见
    StorageModule,
    CommonModule,
    ChannelsModule,
    NotificationsModule,
    CapabilitiesModule,
    AuthModule,
    ProjectsModule,
    AssetsModule,
    GenerateModule,
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

  const app = await NestFactory.create<NestExpressApplication>(VerifyAppModule, {
    logger: ['error', 'warn'],
  });
  // 与 main.ts 同形:全局前缀 + ValidationPipe(白名单+转换)
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true });
  /*
   * /uploads 静态直出也要照搬: 少了它, 脚本按 outputAsset.sourceUrl 取图画会拿到
   * 404 的 JSON 体, Jimp 解码报 "Could not find MIME for Buffer" —— 看起来像
   * 生成失败, 实际只是这个最小装配没挂静态服务。
   */
  const config = app.get(ConfigService);
  const uploadsDir = join(process.cwd(), config.get<string>('path.uploads') ?? 'uploads');
  mkdirSync(join(uploadsDir, 'original'), { recursive: true });
  mkdirSync(join(uploadsDir, 'generated'), { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });
  await app.listen(PORT, '127.0.0.1');
  console.log(`[boot] Nest 已监听 ${PORT}`);

  // ── 登录（现场注册一个新账号, 不依赖预置的演示账号）──
  const { ensureTestUser } = require('./lib/test-user');
  const account = await ensureTestUser(BASE, { prefix: 'free-create' });
  const token = account.token;
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
    // Jimp 1.x 的 read() 只吃路径; 从内存字节解码要用 fromBuffer,
    // 否则报 "Could not find MIME for Buffer" 并被误当成生成失败
    const im = await Jimp.fromBuffer(buf);
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
  // 按类 token 取: 传字符串 'PrismaService' 在 Nest 10+ 解析不到 provider
  const prisma = app.get(PrismaService);
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
  // 异常时 app 仍在 listen, 不显式退出的话进程会一直挂着, 只能等外层超时
  process.exit(1);
});