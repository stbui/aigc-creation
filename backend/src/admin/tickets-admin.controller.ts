import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { AdminUser, RequireAllPermissions, RequirePermission } from "./admin.decorator";
import type { AdminUser as AdminUserType } from "./admin.decorator";
import { PERMISSIONS } from "./permissions";
import { sendCsv } from "../common/csv-response";
import { TicketsService } from "../tickets/tickets.service";
import {
  AdminTicketListQueryDto,
  AdminTicketReplyDto,
  AdminTicketTransferDto,
  AdminTicketUpdateDto,
} from "./dto/ticket.dto";

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
@Controller("admin/tickets")
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** 各状态计数（侧栏角标与看板卡片用） */
  @Get("stats")
  @RequirePermission(PERMISSIONS.ticketRead)
  stats() {
    return this.tickets.stats();
  }

  /**
   * 导出（CSV）。
   *
   * ⚠️ 路由必须声明在 `:id` 之前，否则 `export` 会被当成工单 id。
   */
  @Get("export")
  @RequireAllPermissions(PERMISSIONS.ticketRead, PERMISSIONS.dataExport)
  async export(@Query() query: AdminTicketListQueryDto, @Res() res: Response) {
    const csv = await this.tickets.exportCsv(query);
    sendCsv(res, "tickets", csv);
  }

  /**
   * 可指派的接收人（启用中的后台账号）。
   *
   * 运营/财务没有 `user.read`，不能借用用户列表接口筛后台角色；这里只暴露
   * 指派需要的 id / 名称 / 邮箱 / 角色，不返回权限点或账号状态以外的信息。
   */
  @Get("assignees")
  @RequirePermission(PERMISSIONS.ticketHandle)
  assignees() {
    return this.tickets.adminAssignees();
  }

  @Get()
  @RequirePermission(PERMISSIONS.ticketRead)
  list(@Query() query: AdminTicketListQueryDto) {
    return this.tickets.adminList(query);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.ticketRead)
  detail(@Param("id") id: string) {
    return this.tickets.adminDetail(id);
  }

  /** 客服回复。回复即受理，会推送站内消息给用户 */
  @Post(":id/replies")
  @RequirePermission(PERMISSIONS.ticketHandle)
  reply(
    @Param("id") id: string,
    @Body() dto: AdminTicketReplyDto,
    @AdminUser() actor: AdminUserType,
  ) {
    return this.tickets.adminReply(id, actor, dto.content, dto.visibility ?? "public");
  }

  /**
   * 转交财务。
   *
   * 与退款严格分开：这里只写内部备注、指派接收人并把状态推到 processing，
   * 不改订单、积分或退款。退款仍由财务在订单模块执行。
   */
  @Post(":id/transfer")
  @RequirePermission(PERMISSIONS.ticketHandle)
  transfer(
    @Param("id") id: string,
    @Body() dto: AdminTicketTransferDto,
    @AdminUser() actor: AdminUserType,
  ) {
    return this.tickets.adminTransfer(id, actor, dto.assigneeId, dto.note);
  }

  /** 状态流转 / 改优先级 / 指派 */
  @Patch(":id")
  @RequirePermission(PERMISSIONS.ticketHandle)
  update(
    @Param("id") id: string,
    @Body() dto: AdminTicketUpdateDto,
    @AdminUser() actor: AdminUserType,
  ) {
    return this.tickets.adminUpdate(id, dto, actor);
  }
}
