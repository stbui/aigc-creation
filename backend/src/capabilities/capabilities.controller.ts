import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  WORKBENCH_CAPABILITIES,
  defaultParamsFor,
} from './capability.registry';
import { CreditPriceService } from '../credits/credit-price.service';
import { PrismaService } from '../prisma/prisma.service';
import { CREDIT_SCALE } from '../model/infra/microcredits';
import { defaultCreditCostOf, getCapability } from './capability.registry';
import { normalizeCapability } from '../model/domain/capability-config';
import { CapabilityAvailabilityService } from './capability-availability.service';
import { OptionalJwtAuthGuard } from '../common/optional-jwt-auth.guard';

/**
 * 能力清单下发接口 (公开, 免登录)。
 *
 * 前端不硬编码任何能力清单 —— 卡片、侧栏、表单全部由这里的数据渲染,
 * 新增/下线能力只改 registry 一处。
 */
@Controller('capabilities')
@UseGuards(OptionalJwtAuthGuard)
export class CapabilitiesController {
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
  @Get()
  async list(@Req() req: { user?: { id: string } }) {
    const [pricingRows, runtime] = await Promise.all([
      this.prisma.capabilityPricing.findMany(),
      this.availability.runtimeAll(),
    ]);
    const pricingById = new Map(pricingRows.map((row) => [row.capabilityId, row]));
    const items = await Promise.all(CAPABILITIES.map(async (c) => {
      const definition = getCapability(c.id) ?? c;
      const row = pricingById.get(c.id);
      const textCapability = normalizeCapability(definition.model.capability) === 'text';
      const billingMode = row?.billingMode ?? (textCapability ? 'token' : 'fixed_request');
      const fixedUnit = row
        ? Number(row.unitPriceMicrocredits)
        : billingMode === 'fixed_request'
          ? Number(CREDIT_SCALE) * defaultCreditCostOf(c.id)
          : 0;
      const campaignId = await this.price.freeCampaignIdOf(c.id, req.user?.id);
      return {
        ...c,
        creditCost: campaignId ? 0 : billingMode === 'token' ? 0 : Math.round(fixedUnit / Number(CREDIT_SCALE)),
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
    }));
    return {
      groups: CAPABILITY_GROUPS,
      // 顺序即侧栏与工作台的展示顺序
      items,
      workbenchIds: WORKBENCH_CAPABILITIES.map((c) => c.id),
    };
  }
}
