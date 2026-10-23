import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../channels/email/email.service';
import { SmsService } from '../channels/sms/sms.service';

class BroadcastDto {
  @IsString()
  @IsNotEmpty({ message: '请填写公告标题' })
  @MaxLength(80)
  title: string;

  @IsString()
  @IsNotEmpty({ message: '请填写公告正文' })
  @MaxLength(2000)
  body: string;

  /** 站内相对路径，如 /packages；留空表示不可点 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  link?: string;
}

class UpsertTemplateDto {
  @IsString()
  @IsNotEmpty({ message: '请填写模板编码' })
  @MaxLength(60)
  code: string;

  @IsIn(['inapp', 'email', 'sms'], { message: '未知的通道' })
  channel: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @IsString()
  @IsNotEmpty({ message: '请填写模板正文' })
  @MaxLength(2000)
  body: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * 后台站内消息：全站广播 + 模板管理。
 *
 * 广播是**不可撤回**的写扩散（每个活跃用户一行），因此要审计；
 * 模板改动影响所有后续通知，同样审计。
 */
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  /**
   * 邮件 / 短信通道的真实生效状态。
   *
   * 这两个通道「填了真实 provider 但缺凭据」时会**静默回落 console**（告警在
   * 启动日志里，跑起来之后没人再看）。没有这条只读接口，运营无法判断一封
   * 验证码邮件是不是真的发出去了 —— 页面只能猜。
   *
   * 只回 provider / delivers / configured 与展示用的发信地址或签名，
   * **不含任何凭据**。
   */
  @Get('channels')
  @RequirePermission(PERMISSIONS.messageWrite)
  channels() {
    return { email: this.email.status(), sms: this.sms.status() };
  }

  @Post('broadcast')
  @RequirePermission(PERMISSIONS.messageWrite)
  @AuditAction('notification.broadcast')
  broadcast(@Body() dto: BroadcastDto) {
    return this.notifications.broadcast(dto.title, dto.body, dto.link);
  }

  @Get('templates')
  @RequirePermission(PERMISSIONS.messageWrite)
  templates() {
    return this.notifications.templates();
  }

  @Post('templates')
  @RequirePermission(PERMISSIONS.messageWrite)
  @AuditAction('notification.template')
  upsertTemplate(@Body() dto: UpsertTemplateDto) {
    return this.notifications.upsertTemplate(dto);
  }
}
