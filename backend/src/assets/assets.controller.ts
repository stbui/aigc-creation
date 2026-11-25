import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RateLimit } from '../common/rate-limit.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AssetsService } from './assets.service';
import { AppError } from '../common/app.exception';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { MoveAssetsDto } from './dto/move-asset.dto';
import { AssetListQueryDto } from './dto/list-asset.dto';

@UseGuards(JwtAuthGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  // 上传按用户计 30 次/分钟：单次上传是磁盘 + 尺寸探测（Jimp 解码），
  // 批量拖拽 20 张是正常场景，留足余量
  @RateLimit({ name: 'asset-upload', limit: 30, windowSec: 60, scope: 'user' })
  @Post('upload')
  // storage / limits 由 `AssetsModule` 的 MulterModule 提供：装饰器参数在类定义期
  // 求值，只能直读 process.env，故不在这里写。见该文件的说明。
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAssetDto,
  ) {
    if (!file) throw new AppError(40001, '请选择要上传的图片', 400);
    return this.assetsService.createOriginal(
      user.id,
      dto.projectId,
      {
        filename: file.filename,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      },
      {
        sourceSite: dto.sourceSite,
        sourceTitle: dto.sourceTitle,
        sourcePageUrl: dto.sourcePageUrl,
      },
    );
  }

  /**
   * 批量移动素材到另一个项目 (分组)。
   *
   * 浏览器扩展的「换分组再保存」是批量语义: 一次选中 N 张、已落到默认分组,
   * 再整体改投目标分组 —— 逐条 PATCH 会放大成 N 次请求且中途失败无法回滚,
   * 故做成批量端点。校验一次目标项目归属, 再按 ownerId 过滤素材。
   */
  @Patch('move')
  move(@CurrentUser() user: AuthUser, @Body() dto: MoveAssetsDto) {
    return this.assetsService.moveToProject(user.id, dto.ids, dto.projectId);
  }

  /** 素材库列表: 支持 kind / capability 筛选与分页 */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: AssetListQueryDto) {
    return this.assetsService.list(user.id, query);
  }

  /** 单个素材详情: 用户端历史恢复按 id 找回模板与参考图 */
  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assetsService.getOne(user.id, id);
  }

  /** 删除素材 (生成图会连带删除产出它的任务) */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assetsService.remove(user.id, id);
  }
}
