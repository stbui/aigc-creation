import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { StorageBackend } from '../storage/storage.provider';

/**
 * 账号生命周期 —— 注销的**唯一实现**。
 *
 * 后台用户管理（`admin/users.service.remove`）与 C 端自助注销走同一份逻辑：
 * 两处各写一遍必然漂移，而漂移的方向通常是「C 端漏删了某个子表」，
 * 表现为注销后仍能收到通知 / 仍能被短信登录找回。这类 bug 很难被冒烟发现。
 *
 * 硬约束（法务）：
 *   · **订单、支付、退款、发票、积分流水一律保留** —— 受会计与消费者权益
 *     相关法规的留存要求约束，不能随账号物理消失；
 *   · 可识别信息匿名化（邮箱改写、昵称置空、密码清空）；
 *   · `tokenVersion + 1`，已签发的全部 token 立即失效。
 */
@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** 注销前的影响面预览（前端必须展示给用户确认） */
  async impact(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, createdAt: true },
    });
    const [projects, tasks, assets, orders, notifications] = await Promise.all([
      this.prisma.project.count({ where: { ownerId: userId } }),
      this.prisma.generationTask.count({ where: { ownerId: userId } }),
      this.prisma.asset.count({ where: { ownerId: userId } }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return { email: user?.email, name: user?.name, createdAt: user?.createdAt, projects, tasks, assets, orders, notifications };
  }

  /**
   * 软注销（C 端自助）。
   *
   * 承诺与实现必须一一对应（注销确认页原话）：
   *   · 「作品、素材与积分将被清除」 → 删任务、素材、项目、积分批次（含文件）；
   *   · 「订单、支付与积分流水会以匿名化形式保留」 → 资金相关记录与积分流水保留。
   *
   * 两条承诺在这里相遇：积分流水必须留，积分批次必须删。流水上的 `lotId`
   * 指向批次，故先断开引用再删批次 —— 余额永远从批次推导，批次清空即余额归零，
   * 而"某笔积分当初发过多少、用在哪里"的流水证据仍在。
   */
  async softDelete(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { id: userId, deleted: false };

    // 文件删除要在库记录删掉之前把这些坐标先取出来（删完就查不到了）
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId },
      select: { storageBackend: true, storageKey: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // 作品（任务）→ 素材 → 项目：外键方向要求按这个顺序删
      await tx.generationTask.deleteMany({ where: { ownerId: userId } });
      await tx.asset.deleteMany({ where: { ownerId: userId } });
      await tx.project.deleteMany({ where: { ownerId: userId } });

      // 积分：先断开流水对批次的引用（流水保留），再删批次
      await tx.creditLedger.updateMany({ where: { userId }, data: { lotId: null } });
      await tx.creditLot.deleteMany({ where: { userId } });

      /*
       * 会员必须在同一次注销里终止。
       * 生效中的会员带着 nextCreditAt，调度器到点会**给这个已注销的账号
       * 重新建积分批次** —— 刚清空的积分又长回来，注销等于没做。
       * 这里不主动退款：注销是用户主动放弃权益，退款走客服/后台流程。
       */
      await tx.membership.updateMany({
        where: { userId, status: { in: ['active', 'grace'] } },
        data: { status: 'cancelled', nextCreditAt: null },
      });

      await tx.loginSession.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.accountToken.deleteMany({ where: { userId } });
      // 登录审计断开关联但保留记录（安全事件举证）
      await tx.loginLog.updateMany({ where: { userId }, data: { userId: null } });
      await tx.consentRecord.updateMany({ where: { userId }, data: { userId: null } });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'deleted',
          email: `deleted_${userId}@anonymized.local`,
          name: '已注销用户',
          passwordHash: '',
          phone: null,
          phoneVerifiedAt: null,
          tokenVersion: { increment: 1 },
        },
      });
    });

    /*
     * 文件在事务之后删：按**写入时的后端**逐个删，失败不阻塞注销。
     * 库记录已不存在，注销不能被一个删不掉的 OSS 对象卡住。
     */
    for (const a of assets) {
      if (!a.storageKey) continue;
      const backend = (a.storageBackend as StorageBackend) ?? 'local';
      await this.storage.get(backend)?.delete(a.storageKey).catch(() => undefined);
    }

    return { id: userId, deleted: true, removed: { assets: assets.length } };
  }
}
