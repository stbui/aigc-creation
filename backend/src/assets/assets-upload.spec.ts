import { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { AssetsModule } from './assets.module';
import { AssetsService } from './assets.service';

/** 1x1 合法 PNG */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * `AssetsModule` 的上传装配（起真实 Nest HTTP，不引 AppModule，
 * 因此不需要数据库 / Redis）。
 *
 * 守的是「配置层的 `path.uploads` 有没有真的进到 multer」。上传落盘参数从
 * controller 装饰器移到模块级 `MulterModule.registerAsync` 之后，注入一旦断掉
 * **不会报错**：`FileInterceptor` 静默回落 multer 默认的 memoryStorage，
 * `file.filename` / `file.path` 全部变 undefined，要等 service 去读临时文件才炸
 * —— 装配期毫无信号，用户侧只表现为上传莫名失败。这类静默回落必须锁在装配层。
 *
 * 守卫用官方的 `overrideGuard` 替身：它们是 `@UseGuards(ClassRef)` 直接引用，
 * `overrideProvider` 换不掉。
 */
describe('AssetsModule 的上传装配', () => {
  let app: INestApplication;
  let uploadsDir: string;
  let previousUploadDir: string | undefined;
  const received: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'assets-upload-'));
    // 落盘目录的唯一来源是 UPLOAD_DIR（`resolveUploadsDir` 读它，service 重建
    // 临时路径也读它）；测试把它指到临时目录，避免写进仓库的 uploads-test/。
    previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadsDir;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AssetsModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<Record<string, unknown>>();
          req.user = { id: 'owner-1', email: 'owner@example.com' };
          return true;
        },
      })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(AssetsService)
      .useValue({
        createOriginal: (_owner: string, _project: string, file: Record<string, unknown>) => {
          received.push(file);
          return { id: 'asset-1' };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    // 还原而不是 delete：vitest 的 worker 会跨文件复用，留下空值会影响后续用例
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('落盘目录取自配置层的 path.uploads，没有静默回落 memoryStorage', async () => {
    const res = await request(app.getHttpServer())
      .post('/assets/upload')
      .field('projectId', 'project-1')
      .attach('file', PNG_1X1, 'photo.png')
      .timeout(5000);

    expect(res.status).toBe(201);
    expect(received).toHaveLength(1);
    const file = received[0];
    // diskStorage 独有的字段：缺任意一条即说明 multer 用了默认的内存存储
    expect(typeof file.filename).toBe('string');
    expect(file.filename).toBeTruthy();
    expect(existsSync(join(uploadsDir, 'original', file.filename as string))).toBe(true);
    expect(typeof file.originalname).toBe('string');
    expect(typeof file.mimetype).toBe('string');
    expect(typeof file.size).toBe('number');
    expect(file.buffer).toBeUndefined();
  });

  it('文件名按 UUID 重命名，不沿用客户端声明的原始名', async () => {
    const res = await request(app.getHttpServer())
      .post('/assets/upload')
      .field('projectId', 'project-1')
      .attach('file', PNG_1X1, '../../evil name.png')
      .timeout(5000);

    expect(res.status).toBe(201);
    const filename = received.at(-1)?.filename as string;
    expect(filename).not.toContain('..');
    expect(filename).not.toContain(' ');
    expect(filename).toMatch(/^[0-9a-f-]{36}\.png$/i);
  });

  /*
   * 「一次只收一张」这条契约。
   *
   * ⚠️ 依据是官方 `FileInterceptor` 内部调的 `multer.single()`（写死
   * `maxCount: 1`），**不是**模块级 `limits.files`：实测把 `limits` 整段删掉，
   * 第二条附件仍然被 400 拒掉。这里断言的是路由契约，不要误读成它在守
   * `assets.module` 的 limits 装配 —— 后者由上一条 storage 用例守。
   */
  it('一次只收一张文件（multer.single 的 maxCount，不是 limits.files）', async () => {
    const before = received.length;
    const res = await request(app.getHttpServer())
      .post('/assets/upload')
      .field('projectId', 'project-1')
      .attach('file', PNG_1X1, 'a.png')
      .attach('file', PNG_1X1, 'b.png')
      .timeout(5000);

    expect(res.status).toBe(400);
    expect(received.length).toBe(before);
  });
});
