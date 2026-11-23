import { Injectable } from '@nestjs/common';
import { isAdminRole } from '../../admin/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelService } from './channel.service';

/**
 * 公开系统渠道投影。
 *
 * 匿名 / 普通用户只拿中转入口与模型列表；管理员额外拿到真实名称与上游地址。
 * 凭证任何情况下都不下发 —— 由 ChannelService 的两个投影各自保证。
 */
@Injectable()
export class PublicChannelsService {
  constructor(
    private readonly channels: ChannelService,
    private readonly prisma: PrismaService,
  ) {}

  async systemChannels(userId?: string) {
    const admin = await this.isAdmin(userId);
    const rows = admin
      ? await this.channels.adminSystemChannels()
      : await this.channels.publicSystemChannels();
    return { channels: rows };
  }

  /**
   * 是否为后台角色。
   *
   * 实时查库而不是信 token 里的 role —— 降权与停用必须立即生效。
   * 查库失败按「非管理员」处理：宁可少给上游地址，也不能因为一次数据库
   * 抖动就把内部拓扑暴露给匿名访客。
   */
  private async isAdmin(userId?: string): Promise<boolean> {
    if (!userId) return false;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, status: true },
      });
      return Boolean(user && user.status === 'active' && isAdminRole(user.role));
    } catch {
      return false;
    }
  }
}
