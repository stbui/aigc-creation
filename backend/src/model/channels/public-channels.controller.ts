/**
 * 公开的系统渠道连接信息（`/api/v1/channels/system`）。
 *
 * 设计文档 §4.1 列了这个端点，语义是「系统渠道连接信息（**非管理员不下发**）」。
 * 本仓的落地口径：
 *
 *   1. **匿名 / 普通用户**：只给「有哪些系统渠道、有哪些模型、中转入口在哪」。
 *      凭证恒为 `'system'`（由服务端注入），上游真实地址改写成中转入口
 *      `/api/v1/ai/system/{channelId}` —— 这是 `publicChannel(row, false)`
 *      已经实现的投影；
 *   2. **管理员**：额外拿到渠道真实名称与上游地址。管理员在后台本来就看得到
 *      这些，多给一份不会扩大泄漏面，但省去「切到后台才能看到怎么连」的来回。
 *      **凭证（apiKey / secretKey）任何情况下都不下发** —— 后台投影里也从不回显。
 *   3. **判定实时查库**：角色是可变状态（降权 / 停用），不信 JWT 载荷。
 *
 * 为什么单独开一个端点而不是复用 `/admin/channels`：后台列表带完整模型与
 * 价格档（管理视角），C 端只需要「有哪些模型、怎么连」这一层。
 *
 * 角色判定与投影选择在 PublicChannelsService，Controller 只做 HTTP 适配。
 */

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../../common/optional-jwt-auth.guard';
import { PublicChannelsService } from './public-channels.service';

@Controller('channels')
export class PublicChannelsController {
  constructor(private readonly publicChannels: PublicChannelsService) {}

  /** 系统渠道连接信息：渠道 id、中转入口、可用模型与售价口径 */
  @Get('system')
  @UseGuards(OptionalJwtAuthGuard)
  system(@Req() req: { user?: { id: string } }) {
    return this.publicChannels.systemChannels(req.user?.id);
  }
}
