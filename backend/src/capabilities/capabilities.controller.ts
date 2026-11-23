import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../common/optional-jwt-auth.guard';
import { CapabilitiesService } from './capabilities.service';

/**
 * 能力清单下发接口 (公开, 免登录)。
 *
 * 前端不硬编码任何能力清单 —— 卡片、侧栏、表单全部由这里的数据渲染,
 * 新增/下线能力只改 registry 一处。
 */
@Controller('capabilities')
@UseGuards(OptionalJwtAuthGuard)
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilitiesService) {}

  @Get()
  list(@Req() req: { user?: { id: string } }) {
    return this.capabilities.list(req.user?.id);
  }
}
