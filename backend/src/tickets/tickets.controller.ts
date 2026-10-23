import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { RateLimit, type RateLimitOptions } from '../common/rate-limit.guard';
import { TicketsService } from './tickets.service';
import { CreateTicketDto, MyTicketListQueryDto, ReplyTicketDto } from './dto/ticket.dto';

/**
 * 新建工单限流: 5 次/分/用户。
 *
 * 工单本身不产生外部成本，但每张工单都会进入客服队列 —— 无限刷单
 * 等于把客服的人力成本交给任何一个注册用户。回复不限流：正常会话
 * 频率天然低，而卡住一条「还要多久」的追问体验代价更高。
 */
const RL_TICKET_CREATE: RateLimitOptions = {
  name: 'ticket-create',
  limit: 5,
  windowSec: 60,
  scope: 'user',
};

/**
 * C 端工单。
 *
 * 所有查询都在 service 层按 `userId` 过滤（不是先查再比对），
 * 越权访问一律 404：不泄露「这个工单号存在」。
 */
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: MyTicketListQueryDto) {
    return this.tickets.listMine(user.id, q);
  }

  @Post()
  @RateLimit(RL_TICKET_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(user.id, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.detailMine(user.id, id);
  }

  @Post(':id/replies')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyTicketDto) {
    return this.tickets.replyAsUser(user.id, id, dto.content);
  }

  /** 用户主动关闭（问题自己解决了） */
  @Post(':id/close')
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.closeAsUser(user.id, id);
  }
}
