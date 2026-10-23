import { Body, Controller, Get, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AigcLabelService } from './aigc-label.service';
import { AdminUser, AuditAction, RequirePermission } from '../admin/admin.decorator';
import { PERMISSIONS } from '../admin/permissions';
import { AIGC_LABEL_POSITIONS } from '../common/aigc-label.config';

/**
 * 角标样式入参。
 *
 * 范围校验与 `sanitizeAigcLabelSpec` 双重进行：DTO 负责「明显不合法就拒绝」，
 * sanitize 负责「存量 / 绕过前端的值夹紧到合法区间」。两者都要有 ——
 * 只有 sanitize 会让运营把 300 号字存进库、界面却显示 120，分不清哪个是真值。
 */
export class AigcLabelSpecDto {
  /** 是否在产出图上显示可见角标（默认开启）。关闭后仅写隐式标识 */
  @IsOptional() @IsBoolean() enabled?: boolean;

  @IsString() @MaxLength(20) text!: string;
  @IsString() @MaxLength(120) fontFamily!: string;
  @IsInt() @Min(12) @Max(120) fontSize!: number;
  @IsInt() @Min(100) @Max(900) fontWeight!: number;
  @IsNumber() @Min(0) @Max(20) letterSpacing!: number;

  @Matches(/^#[0-9a-fA-F]{6}$/, { message: '文字颜色必须是 #rrggbb' })
  textColor!: string;
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: '底色必须是 #rrggbb' })
  backgroundColor!: string;
  @IsInt() @Min(0) @Max(100) backgroundOpacity!: number;

  @IsInt() @Min(0) @Max(120) radius!: number;
  @IsInt() @Min(0) @Max(160) paddingX!: number;
  /** 空串 = 不画圆点 */
  @IsOptional()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: '圆点颜色必须是 #rrggbb 或留空' })
  dotColor?: string;

  @IsIn(AIGC_LABEL_POSITIONS) position!: (typeof AIGC_LABEL_POSITIONS)[number];

  @IsInt() @Min(4) @Max(60) scalePercent!: number;
  @IsInt() @Min(16) @Max(2048) minWidthPx!: number;
  @IsInt() @Min(16) @Max(4096) maxWidthPx!: number;
  @IsNumber() @Min(0) @Max(10) marginPercent!: number;
  /** 下限 20：低于此值角标在浅色图上几乎不可见，等于没有显式标识 */
  @IsInt() @Min(20) @Max(100) opacity!: number;
}

export class UpdateAigcLabelDto {
  @IsObject()
  @ValidateNested()
  @Type(() => AigcLabelSpecDto)
  spec!: AigcLabelSpecDto;

  /**
   * 后台页面用 Canvas 渲染的角标 PNG（base64）。
   *
   * 不传 = 沿用已保存的位图（若文案/字体也改了，该位图会被标记为过期）。
   */
  @IsOptional() @IsString() @MaxLength(800_000) badgePngBase64?: string;

  /** 操作原因。写入属高危动作，会进审计日志 */
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/**
 * C 端公开的角标展示参数。
 *
 * 只回「播放器角标要画成什么样」的几个字段：图片的角标已烙进像素，
 * 视频没有内嵌能力（无 ffmpeg），只能由前端按同一份文案补显式标识。
 * 位图与几何不需要，也不应该外发。
 */
@Controller('aigc-label')
export class AigcLabelController {
  constructor(private readonly label: AigcLabelService) {}

  @Get()
  publicSpec() {
    return this.label.publicSpec();
  }
}

/**
 * 后台「AI 标识」页。
 *
 * 权限沿用 `setting.read` / `setting.write`：这是发给全体用户的合规标识，
 * 与站点设置同一批人授权，不另开权限点（新增权限点意味着角色矩阵再迁一次）。
 */
@Controller('admin/aigc-label')
export class AdminAigcLabelController {
  constructor(private readonly label: AigcLabelService) {}

  @Get()
  @RequirePermission(PERMISSIONS.settingRead)
  read() {
    return this.label.adminView();
  }

  @Put()
  @RequirePermission(PERMISSIONS.settingWrite)
  @AuditAction('aigc.label_update')
  async update(@Body() dto: UpdateAigcLabelDto, @AdminUser() user: AdminUser) {
    await this.label.save({ spec: dto.spec, badgePngBase64: dto.badgePngBase64 }, user.email);
    return this.label.adminView();
  }
}
