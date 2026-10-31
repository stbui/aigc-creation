/**
 * 渠道健康投影 —— 后台「值班塔」与渠道工作台的一行一条线路视图。
 *
 * ## 为什么按渠道模型出表
 *
 * 新模型层里**渠道模型才是线路最小单位**：同一渠道下的模型可以各自停用，
 * 404 也只冷却那一个模型，不连坐整条渠道。按渠道聚合会把「这家有一条模型
 * 挂了」显示成「这家坏了」，值班时按错的地方去按。
 *
 * ## 冷却来自进程内存
 *
 * `RouteHealthService` 只在当前实例内存里记冷却（本仓没有 Redis）。多实例
 * 部署时这里只反映本实例看到的那部分 —— 如实呈现，不做跨实例聚合的假象。
 *
 * ## 协议未知 = 一定失败
 *
 * 渠道模型保存时就会校验协议，但插件卸载后存量行会指向不存在的协议。
 * 这里用注册表现查，让「协议未实现」在值班塔上可见，而不是等任务失败
 * 再去翻调用记录。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProtocolRegistry } from '../protocol/registry';
import { RouteHealthService } from '../routing/route-health.service';

/** 一条线路（渠道模型）的健康投影 */
export interface ChannelHealthRow {
  /** 渠道模型 id —— 与渠道 id 不同，前端据此跳转与去重 */
  id: string;
  channelId: string;
  channelName: string;
  /** 展示名：优先渠道模型显示名，缺失时回落 modelKey */
  name: string;
  /** 'text' | 'image' | 'video' | 'audio' */
  capability: string;
  /** 渠道启用 **且** 模型自身启用才算可用 */
  enabled: boolean;
  /** 协议在当前进程的注册表里是否存在 */
  protocolKnown: boolean;
  /** 冷却解封时间（ISO）；未冷却为 null */
  coolingUntil: string | null;
}

@Injectable()
export class ChannelHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: RouteHealthService,
    private readonly protocols: ProtocolRegistry,
  ) {}

  /** 全量线路健康（未删除的渠道与渠道模型） */
  async list(): Promise<ChannelHealthRow[]> {
    const now = Date.now();
    const cooling = new Map(this.health.snapshot(now).map((block) => [block.key, block.until]));

    const [channels, models] = await Promise.all([
      this.prisma.modelChannel.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, enabled: true },
      }),
      this.prisma.channelModel.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          channelId: true,
          modelKey: true,
          displayName: true,
          capability: true,
          protocol: true,
          enabled: true,
        },
      }),
    ]);

    const channelById = new Map(channels.map((row) => [row.id, row]));
    const rows: ChannelHealthRow[] = [];
    for (const model of models) {
      const channel = channelById.get(model.channelId);
      if (!channel) continue;

      // 两个冷却键取较晚的那个：渠道级（401/403/429）与模型级（404）都可能命中
      const until = Math.max(
        cooling.get(`channel:${channel.id}`) ?? 0,
        cooling.get(`channel-model:${model.id}`) ?? 0,
      );

      rows.push({
        id: model.id,
        channelId: channel.id,
        channelName: channel.name,
        name: model.displayName || model.modelKey,
        capability: model.capability,
        enabled: channel.enabled && model.enabled,
        protocolKnown: this.protocols.has(model.protocol),
        coolingUntil: until > now ? new Date(until).toISOString() : null,
      });
    }

    return rows.sort(
      (left, right) =>
        left.channelName.localeCompare(right.channelName) || left.name.localeCompare(right.name),
    );
  }
}
