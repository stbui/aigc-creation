import { Injectable } from '@nestjs/common';
import { CreditPriceService } from '../credits/credit-price.service';
import { normalizeCapability } from '../model/domain/capability-config';
import { CREDIT_SCALE } from '../model/infra/microcredits';
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
  ) {}

  /**
   * `creditCost` 是能力级售价的单值摘要：按次/按秒取配置价，Token 能力取 0。
   * 完整的 Token 价格仍通过能力详情与报价接口下发，绝不回落到旧的
   * `SystemSetting['creditPrice.*']`——那会制造第二套售价事实源。
   */
  async list(userId?: string) {
    const [pricingRows, runtime] = await Promise.all([
      this.prisma.capabilityPricing.findMany(),
      this.availability.runtimeAll(),
    ]);
    const pricingById = new Map(pricingRows.map((row) => [row.capabilityId, row]));
    const items = await Promise.all(
      CAPABILITIES.map(async (c) => {
        const definition = getCapability(c.id) ?? c;
        const row = pricingById.get(c.id);
        const textCapability = normalizeCapability(definition.model.capability) === 'text';
        const billingMode = row?.billingMode ?? (textCapability ? 'token' : 'fixed_request');
        const fixedUnit = row
          ? Number(row.unitPriceMicrocredits)
          : billingMode === 'fixed_request'
            ? Number(CREDIT_SCALE) * defaultCreditCostOf(c.id)
            : 0;
        const campaignId = await this.price.freeCampaignIdOf(c.id, userId);
        return {
          ...c,
          creditCost: campaignId
            ? 0
            : billingMode === 'token'
              ? 0
              : Math.round(fixedUnit / Number(CREDIT_SCALE)),
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
      }),
    );
    return {
      groups: CAPABILITY_GROUPS,
      // 顺序即侧栏与工作台的展示顺序
      items,
      workbenchIds: WORKBENCH_CAPABILITIES.map((c) => c.id),
    };
  }
}
