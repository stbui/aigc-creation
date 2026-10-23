import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AdminUser, AuditAction, RequirePermission } from './admin.decorator';
import type { AdminUser as AdminUserType } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { csvFilename } from '../common/csv';
import { TicketsService } from '../tickets/tickets.service';
import {
  AdminTicketListQueryDto,
  AdminTicketReplyDto,
  AdminTicketUpdateDto,
} from './dto/ticket.dto';

/**
 * 工单处理（后台）。
 *
 * 权限: 读 `ticket.read`，处理（回复 / 流转 / 指派）`ticket.handle`。
 * 两者分开是因为「能看用户投诉」与「能以平台身份回复用户」不是一回事 ——
 * 回复会直接推到用户站内消息里，是一次对外发言。
 *
 * 关联订单只做只读跳转，退款 / 补发积分仍回订单与积分模块：那里有退款
 * 时间窗、可退上限、积分回收一整套规则，在工单页再开一条「顺手退款」的
 * 捷径，等于让同一件事有两套规则。
 */
@Controller('admin/tickets')
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** 各状态计数（侧栏角标与看板卡片用） */
  @Get('stats')
  @RequirePermission(PERMISSIONS.ticketRead)
  stats() {
    return this.tickets.stats();
  }

  /**
   * 导出（CSV）。
   *
   * ⚠️ 路由必须声明在 `:id` 之前，否则 `export` 会被当成工单 id。
   */
  @Get('export')
  @RequirePermission(PERMISSIONS.dataExport)
  @AuditAction('data.export')
  async export(@Query() query: AdminTicketListQueryDto, @Res() res: Response) {
    const csv = await this.tickets.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('tickets')}"`);
    res.send(csv);
  }

  @Get()
  @RequirePermission(PERMISSIONS.ticketRead)
  list(@Query() query: AdminTicketListQueryDto) {
    return this.tickets.adminList(query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.ticketRead)
  detail(@Param('id') id: string) {
    return this.tickets.adminDetail(id);
  }

  /** 客服回复。回复即受理，会推送站内消息给用户 */
  @Post(':id/replies')
  @RequirePermission(PERMISSIONS.ticketHandle)
  @AuditAction('ticket.reply')
  reply(@Param('id') id: string, @Body() dto: AdminTicketReplyDto, @AdminUser() actor: AdminUserType) {
    return this.tickets.adminReply(id, actor, dto.content);
  }

  /** 状态流转 / 改优先级 / 指派 */
  @Patch(':id')
  @RequirePermission(PERMISSIONS.ticketHandle)
  @AuditAction('ticket.update')
  update(@Param('id') id: string, @Body() dto: AdminTicketUpdateDto, @AdminUser() actor: AdminUserType) {
    return this.tickets.adminUpdate(id, dto, actor);
  }
}
