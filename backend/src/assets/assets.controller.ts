import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RateLimit } from '../common/rate-limit.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { resolveUploadsDir } from '../config/env-files';
import { AssetsService } from './assets.service';

@UseGuards(JwtAuthGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  // 上传按用户计 30 次/分钟：单次上传是磁盘 + 尺寸探测（Jimp 解码），
  // 批量拖拽 20 张是正常场景，留足余量
  @RateLimit({ name: 'asset-upload', limit: 30, windowSec: 60, scope: 'user' })
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        // multer 的 destination 必须在**模块加载期**就确定（它是装饰器参数，
        // 拿不到 DI 的 ConfigService），故直接读 process.env.UPLOAD_DIR。
        // @nestjs/config 在 NestFactory.create 里就把 .env 读进了 process.env，
        // 而 AppModule 的 import 发生在那之后，故此处能读到正确的值。
        destination: `${resolveUploadsDir()}/original`,
        filename: (_req, file, cb) => {
          const unique = randomUUID();
          const ext = extname(file.originalname) || '.bin';
          cb(null, `${unique}${ext}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: any,
    @Body('projectId') projectId: string,
  ) {
    return this.assetsService.createOriginal(user.id, projectId, {
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    });
  }

  /** 素材库列表: 支持 kind / capability 筛选与分页 */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('capability') capability?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('keyword') keyword?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.assetsService.list(user.id, {
      kind,
      capability,
      limit: Number(limit),
      offset: Number(offset),
      keyword,
      from,
      to,
    });
  }

  /** 删除素材 (生成图会连带删除产出它的任务) */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assetsService.remove(user.id, id);
  }
}
