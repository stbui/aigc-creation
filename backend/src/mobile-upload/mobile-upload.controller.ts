import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { MobileUploadService } from './mobile-upload.service';
import { AppError } from '../common/app.exception';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsOptional } from 'class-validator';

/** 手机端上传的请求体 (令牌) */
class ReceiveUploadDto {
  @IsString()
  @IsNotEmpty({ message: '上传令牌不能为空' })
  @MaxLength(128)
  token: string;
}

/**
 * 手机上传接口。
 *
 * ## 鉴权分两种
 *
 *   电脑端接口 (创建/轮询/取消) → JwtAuthGuard: 是登录用户在操作自己的会话。
 *   手机端接口 (接收图片)      → **令牌鉴权**: 手机是另一台设备, 强制它登录
 *                                会把"扫码即用"变成"扫码先注册"。令牌由电脑端
 *                                登录用户在自己的会话里生成, 短时有效, 猜不到。
 */
@Controller('mobile-upload')
export class MobileUploadController {
  constructor(private readonly service: MobileUploadService) {}

  /** 电脑端: 创建会话 (返回二维码内容与令牌) */
  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: AuthUser, @Body('projectId') projectId: string) {
    if (!projectId) {
      throw new AppError(40001, 'projectId 必传', 400);
    }
    const s = await this.service.create(user.id, projectId);
    return {
      sessionId: s.id,
      token: s.token,
      expiresAt: s.expiresAt,
      status: s.status,
    };
  }

  /** 电脑端: 轮询会话状态 (看手机端是否已传图) */
  @Get('sessions/:id')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const s = this.service.status(user.id, id);
    return {
      sessionId: s.id,
      status: s.status,
      /** 已接收的素材列表 (多图) —— 顺序即构图顺序 */
      assets: s.assets,
      // 兼容字段: 第一张
      assetId: s.assetId,
      assetUrl: s.assetUrl,
      originalFilename: s.originalFilename,
      expiresAt: s.expiresAt,
    };
  }

  /** 电脑端: 取消会话 */
  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.service.cancel(user.id, id);
    return { ok: true };
  }

  /**
   * 手机端: 上传图片 (令牌鉴权, 无需登录)。
   *
   * 用 memoryStorage 收文件: 手机端图片经前端压缩后已很小 (通常 < 2MB),
   * 一次性读进内存再交给存储层, 比落临时盘再搬一次简单, 也少一次 IO。
   */
  @Post('sessions/:id/receive')
  @UseInterceptors(
    FilesInterceptor('file', 9, {
      storage: undefined as any, // 走默认 memoryStorage
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async receive(
    @Param('id') id: string,
    @Body() dto: ReceiveUploadDto,
    @UploadedFiles() files: any[],
  ) {
    if (!files?.length) {
      throw new AppError(40001, '缺少图片文件', 400);
    }
    const s = await this.service.receive(
      id,
      dto.token,
      files.map((f) => ({
        filename: f.originalname || '手机上传图片',
        mimetype: f.mimetype,
        data: f.buffer,
      })),
    );
    return {
      ok: true,
      status: s.status,
      assetId: s.assetId,
      /** 全部素材 (多图) —— 顺序即构图顺序 */
      assets: s.assets,
    };
  }
}
