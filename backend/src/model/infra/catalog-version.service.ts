/**
 * 路由目录版本 —— 后台写入模型/价格/分组后递增，运行期按版本号决定是否重载快照。
 *
 * 为什么需要版本号而不是直接失效本地缓存：目录是进程内快照（P3 起使用），
 * 多实例部署时另一个进程改了价格，本进程的缓存仍然有效。短 TTL 能兜住，
 * 但「后台刚改完价格，前台仍然是旧价」在这套系统里是资损级问题，
 * 所以用一个数据库版本号做显式的跨进程信号：请求命中时比对版本，不一致就重载。
 *
 * 所有写入路径（渠道、渠道模型、价格档、前台模型、分组、插件）都必须调用
 * `invalidate()`；漏调不会报错，只会让其他实例在一段时间内用旧价 —— 因此
 * 这里的注释比代码更重要。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const CATALOG_ROW_ID = 'catalog';

@Injectable()
export class CatalogVersionService {
  private listeners = new Set<(version: number) => void>();

  constructor(private readonly prisma: PrismaService) {}

  /** 读取当前版本（跨进程权威值）；表为空时返回 0，不创建行 */
  async current(): Promise<number> {
    const row = await this.prisma.routeCatalogVersion.findUnique({ where: { id: CATALOG_ROW_ID } });
    return row?.version ?? 0;
  }

  /**
   * 递增版本并通知本进程订阅者。
   *
   * 用 `upsert + increment` 而不是「读-改-写」：两个管理员同时保存时，
   * 读改写会丢掉一次递增，导致第二个进程看不到第一次的变更。
   */
  async invalidate(): Promise<number> {
    const row = await this.prisma.routeCatalogVersion.upsert({
      where: { id: CATALOG_ROW_ID },
      create: { id: CATALOG_ROW_ID, version: 1 },
      update: { version: { increment: 1 } },
    });
    for (const listener of this.listeners) {
      try {
        listener(row.version);
      } catch {
        // 订阅者异常不能影响写入结果：版本已经落库，重载失败会自然重试
      }
    }
    return row.version;
  }

  /** 订阅版本变化；返回取消订阅函数 */
  onChange(listener: (version: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
