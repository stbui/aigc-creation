import { Injectable } from '@nestjs/common';
import { CreditPriceService } from '../credits/credit-price.service';
import { normalizeCapability } from '../model/domain/capability-config';
import { CREDIT_SCALE, ceilDiv, creditAmount, toSafeNumber } from '../model/infra/microcredits';
/*
 * `UserGroupService` 必须是**值导入**：Nest 按构造参数的元数据解析依赖，
 * `import type` 会让这一位参数退化成 Object，应用启动即报「无法解析依赖」。
 * `UserGroupAccess` 只用于类型标注，可以是 type import。
 */
import { UserGroupService } from '../model/user-groups/user-group.service';
import type { UserGroupAccess } from '../model/user-groups/user-group.service';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityAvailabilityService } from './capability-availability.service';
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  WORKBENCH_CAPABILITIES,
  defaultCreditCostOf,
  defaultParamsFor,
  getCapability,
} from './capability.registry';

/**
 * 能力清单下发。
 *
 * 清单本体来自 registry，运行时状态来自 availability，售价来自
 * `CapabilityPricing` 投影；三者在这里合成一份前端可直接渲染的数据。
 */
@Injectable()
export class CapabilitiesService {
  constructor(
    private readonly price: CreditPriceService,
    private readonly availability: CapabilityAvailabilityService,
    private readonly prisma: PrismaService,
    private readonly groups: UserGroupService,
  ) {}

  /**
   * `creditCost` 是能力级售价的单值摘要：按次/按秒取配置价，Token 能力取 0。
   * 完整的 Token 价格仍通过能力详情与报价接口下发，绝不回落到旧的
   * `SystemSetting['creditPrice.*']`——那会制造第二套售价事实源。
   *
   * 摘要**已叠加当前用户分组的计价倍率**：账单按 `access.pricing` 折算实扣，
   * 下发不带倍率会让按钮价低于实扣（分组倍率见后台「用户分组」）。限时免费
   * 与身份有关，因此本方法必须拿到 `userId` 才能给出可信价格。
   */
  async list(userId?: string) {
    const [pricingRows, runtime, freeCampaignIds, access] = await Promise.all([
      this.prisma.capabilityPricing.findMany(),
      this.availability.runtimeAll(),
      this.price.freeCampaignIdsOf(
        CAPABILITIES.map((capability) => capability.id),
        userId,
      ),
      /*
       * 分组配置损坏时 `resolvedGroup` 抛 40301 失败关闭，这里**不回落默认分组**：
       * 回退会让用户在价格上看到一个不属于自己的分组，比一份空清单更危险。
       * `models.controller.ts` 同样不捕获 —— 这类账号在 /models 与 /generate 上
       * 本就已经失败，不是清单接口该掩盖的问题。
       */
      this.groups.accessForUser(userId),
    ]);
    const pricingById = new Map(pricingRows.map((row) => [row.capabilityId, row]));
    const items = CAPABILITIES.map((c) => {
      const definition = getCapability(c.id) ?? c;
      const row = pricingById.get(c.id);
      const textCapability = normalizeCapability(definition.model.capability) === 'text';
      const billingMode = row?.billingMode ?? (textCapability ? 'token' : 'fixed_request');
      const fixedUnit = row
        ? Number(row.unitPriceMicrocredits)
        : billingMode === 'fixed_request'
          ? Number(CREDIT_SCALE) * defaultCreditCostOf(c.id)
          : 0;
      const campaignId = freeCampaignIds.get(c.id) ?? '';
      return {
        ...c,
        creditCost: campaignId
          ? 0
          : billingMode === 'token'
            ? 0
            : displayCreditCost(access, c.id, fixedUnit),
        defaultParams: defaultParamsFor(c.id),
        /*
         * 运行时真相：这一项**此刻**按下去会发生什么。
         *
         * 与 `mode` 正交且**不改 mode 的形状** —— 前端既有逻辑（已接入 / 规划中）
         * 全部基于 mode，动它牵一发动全身；runtime 是增量字段，
         * 新界面用它，老界面不受影响。
         */
        runtime: runtime[c.id],
      };
    });
    return {
      groups: CAPABILITY_GROUPS,
      // 顺序即侧栏与工作台的展示顺序
      items,
      workbenchIds: WORKBENCH_CAPABILITIES.map((c) => c.id),
    };
  }
}

/**
 * 下发给 C 端的整数积分价。
 *
 * 倍率取自 `UserGroupAccess.pricing`，金额取自 `creditAmount` —— 两者都与建账单
 * 的 `BillingService.buildDraft` 同源，取整方向也一致（向上）。标价只会等于或
 * 略高于实扣；反过来「标价低于实扣」属于计费披露缺陷。
 *
 * 残余偏差：分组还可以按**模型 key** 配置覆盖倍率，能力清单没有模型上下文，
 * 因此带覆盖的分组仍以按钮的基础倍率标价，精确价看 `POST /models/quote`。
 */
function displayCreditCost(
  access: UserGroupAccess,
  capabilityId: string,
  unitMicrocredits: number,
): number {
  if (unitMicrocredits <= 0) return 0;
  const { multiplierBasisPoints } = access.pricing('credits', [capabilityId]);
  // 整数向上取整到积分，不经过浮点除法：与计费同为 BigInt 口径，同时保证
  // 不足 1 积分的价格显示 1 而不是 0 —— 0 会被前端读成「免费」。
  const microcredits = creditAmount(unitMicrocredits, 1, multiplierBasisPoints);
  return toSafeNumber(ceilDiv(microcredits, CREDIT_SCALE));
}
