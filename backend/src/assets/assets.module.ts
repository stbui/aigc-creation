import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { resolveUploadsDir } from '../config/env-files';
import { deploymentUploadMaxBytes } from '../common/image-formats';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [
    /*
     * 上传落盘参数集中在这里，不写在 controller 的装饰器里。

     * 装饰器参数在**类定义期**求值，也就是 `AppModule` 被 import 的那一刻，
     * 而 @nestjs/config 要到 `NestFactory.create()` 里才把 env 文件写进
     * `process.env`。于是「谁先被 import」成了隐式前提：顺序错了不报错，只是静默
     * 拿到 `resolveUploadsDir()` 的兜底值 `uploads/`，把「三环境各写各的目录」
     * 这条约定破掉 —— test 档会开始往开发目录写文件。
     *
     * `registerAsync` 的工厂在**实例化阶段**执行，此时 env 一定已经加载完，
     * 上面那条 import 顺序前提随之消失（`assets-upload.spec.ts` 就是先 import
     * 再设 `UPLOAD_DIR`，仍然拿到临时目录；换成导入期求值即失败）。
     * 用 `register()` 不行：它的参数与装饰器一样是导入期求值。
     *
     * 目录仍调用同一个 `resolveUploadsDir()`：`assets.service` 用它重建临时路径、
     * `thumb-render` 用它定位缓存目录。写入方与读取方必须同源，否则文件落在 A
     * 目录而 service 去 B 目录读 —— 所以这里刻意不改成注入 ConfigService 取值，
     * 那等于给同一个路径开第二条来源。
     *
     * 必须注册在**本模块**：multer 选项按模块解析，注册在根模块不会被 feature
     * 模块的拦截器读到（实测：根模块的 limits 对 feature 路由完全无效）。同理，
     * 本控制器若挪去别的模块，那里的 `FileInterceptor` 会拿不到 storage 而静默
     * 回落 multer 默认的 memoryStorage —— 由 `assets-upload.spec.ts` 锁住。
     */
    MulterModule.registerAsync({
      useFactory: () => ({
        storage: diskStorage({
          destination: `${resolveUploadsDir()}/original`,
          filename: (_req, file, cb) => {
            // 扩展名只让临时文件可读；真实格式由 service 按字节魔数判定
            const ext = extname(file.originalname) || '.bin';
            cb(null, `${randomUUID()}${ext}`);
          },
        }),
        // multer 只挡在部署硬上限之外；运营配置的动态上限由 service 读取文件后
        // 按真实生效值校验，避免临时目录先收下超大文件。
        // 注意「一次只收一张」由官方 FileInterceptor 内部的 multer.single()
        // 保证（写死 maxCount: 1），不是靠这里的 files: 1。
        limits: { fileSize: deploymentUploadMaxBytes(), files: 1 },
      }),
    }),
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
