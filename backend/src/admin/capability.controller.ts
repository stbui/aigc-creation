import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminUser, AuditAction, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { PERMISSIONS } from './permissions';
import { CapabilityAvailabilityService } from '../capabilities/capability-availability.service';

/** 上下线入参。下架时 reason 必填（service 侧校验，这里只限长度） */
export class CapabilityToggleDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/**
 * 能力上下线（后台「能力管控」页）。
 *
 * 为什么需要这个开关
 * ---------------
 * 某项能力依赖的厂商通道挂了、或产出质量被投诉，运营需要**立刻停止收单**，
 * 而不是等下一次发版。没有这个开关时唯一手段是下掉整条模型线路 ——
 * 那会连带影响所有能力，把局部故障放大成全站故障。
 *
 * 权限与审计：读 `capability.read`、写 `capability.write`（属高危集合，
 * AuditInterceptor 要求填写原因）。下架原因同时展示给 C 端用户 ——
 * 只说「已下线」会让用户去问客服，写清原因才是可自助的。
 */
@Controller('admin/capabilities')
export class AdminCapabilitiesController {
  constructor(private readonly availability: CapabilityAvailabilityService) {}

  @Get()
  @RequirePermission(PERMISSIONS.capabilityRead)
  list() {
    return this.availability.adminList();
  }

  /**
   * 上线 / 下线。
   *
   * 用 PUT 而非 PATCH：这个端点的语义是「把这项能力置于某状态」（幂等），
   * 重复调用结果一致，符合 PUT 的契约。
   */
  @Put(':id')
  @RequirePermission(PERMISSIONS.capabilityWrite)
  @AuditAction('capability.toggle')
  async set(@Param('id') id: string, @Body() dto: CapabilityToggleDto, @AdminUser() user: AdminUser) {
    try {
      const row = await this.availability.setEnabled(id, dto.enabled, dto.reason, user.email);
      return { capabilityId: row.capabilityId, enabled: row.enabled, reason: row.reason };
    } catch (e) {
      /*
       * service 抛出的是普通 Error（它要保持与 Nest 无关）。
       * 在这里翻译成 400 —— 未知能力 id 对客户端就是「参数不对」，
       * 让它冒成 500 会把运营的输入错误记成服务端故障。
       */
      throw new AppError(40001, (e as Error).message, 400);
    }
  }
}
