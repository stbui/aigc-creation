import { Controller, Get, Param } from '@nestjs/common';
import { LegalService } from './legal.service';

/**
 * 法务文档（公开，免登录）。
 *
 * 未登录用户也必须能读隐私政策 —— 注册页的协议链接对游客可见，
 * 挂 JwtAuthGuard 会让"同意前先看看条款"变成不可能。
 */
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  /** 三类文档的当前版本概览 */
  @Get()
  async index() {
    return this.legal.index();
  }

  /** 取某文档的最新已发布版本；一条都没发布时 `data` 为 null（前端有内置兜底） */
  @Get(':slug')
  async current(@Param('slug') slug: string) {
    return this.legal.current(slug);
  }
}
