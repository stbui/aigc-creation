import { Controller, Get } from '@nestjs/common';
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  WORKBENCH_CAPABILITIES,
  defaultParamsFor,
} from './capability.registry';
import { CreditPriceService } from '../credits/credit-price.service';
import { CapabilityAvailabilityService } from './capability-availability.service';

/**
 * 能力清单下发接口 (公开, 免登录)。
 *
 * 前端不硬编码任何能力清单 —— 卡片、侧栏、表单全部由这里的数据渲染,
 * 新增/下线能力只改 registry 一处。
 */
@Controller('capabilities')
export class CapabilitiesController {
  constructor(
    private readonly price: CreditPriceService,
    private readonly availability: CapabilityAvailabilityService,
  ) {}

  /**
   * ⚠ `creditCost` 在此**覆盖**为运行时生效价 (SystemSetting > registry),
   * 而不是直接透传 registry 字段 —— 前端要显示的是「用户现在实际会被扣多少」,
   * 不是「代码里写的默认值是多少」。后台改价后无需改前端即可生效。
   */
  @Get()
  async list() {
    const [prices, runtime] = await Promise.all([this.price.resolveAll(), this.availability.runtimeAll()]);
    return {
      groups: CAPABILITY_GROUPS,
      // 顺序即侧栏与工作台的展示顺序
      items: CAPABILITIES.map((c) => ({
        ...c,
        creditCost: prices[c.id] ?? c.creditCost ?? 0,
        defaultParams: defaultParamsFor(c.id),
        /*
         * 运行时真相：这一项**此刻**按下去会发生什么。
         *
         * 与 `mode` 正交且**不改 mode 的形状** —— 前端既有逻辑（已接入 / 规划中）
         * 全部基于 mode，动它会牵一发动全身；runtime 是增量字段，
         * 新界面用它，老界面不受影响。
         */
        runtime: runtime[c.id],
      })),
      workbenchIds: WORKBENCH_CAPABILITIES.map((c) => c.id),
    };
  }
}