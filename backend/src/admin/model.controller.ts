import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, AdminUser, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { ModelConfigService } from './model-config.service';
import { ModelCallService } from './model-call.service';
import { PERMISSIONS } from './permissions';
// 值导入: DTO 依赖 design:paramtypes 做实例化与白名单剥离
import { ModelCallListQueryDto, TestChannelDto, UpdateModelConfigDto } from './dto/model.dto';

/**
 * 模型通道配置 (后台「模型配置」页)。
 *
 * 读写权限分离 (model.config_read / model.config_write):
 * 模型配置是**生产关键路径** —— 配错会让全站生图静默回落本地, 或直接打挂远程通道,
 * 因此写权限只给 admin; 运营可读以排障, 但不能改。
 *
 * 所有写操作挂审计 (AuditAction): 配置变更事后要能追责与回溯。
 */
@Controller('admin/model-config')
export class AdminModelConfigController {
  constructor(private readonly config: ModelConfigService) {}

  /** 分组读取全部配置 + 通道状态 + 逐能力路由快照 */
  @Get()
  @RequirePermission(PERMISSIONS.modelConfigRead)
  read() {
    return this.config.readAll();
  }

  /**
   * 批量写入配置。
   *
   * 立即生效: 写入后会重载运行时配置并失效缓存, 无需重启。
   * 凭据类 (gateway.token) 留空 = 保持原值, 清除需走 clears。
   */
  @Patch()
  @RequirePermission(PERMISSIONS.modelConfigWrite)
  @AuditAction('model.config_update')
  update(@Body() dto: UpdateModelConfigDto, @AdminUser() user: AdminUser) {
    return this.config.updateAll(dto?.settings ?? {}, dto?.clears ?? [], user.email, dto?.reason);
  }

  /**
   * 连通性测试。
   *
   * 只探测可达性, 不发真实生成任务 —— 测试动作不该消耗模型额度或产生垃圾产出。
   * 失败时返回真实报错而非静默回落, 否则运营无法区分「配置错了」与「网关挂了」。
   *
   * 按模态分流 (2026-10-20): 三种模态的端点不同, 缺省保持 image
   * (改造前的唯一行为), 不传模态的存量脚本不会因此改变结果。
   */
  @Post('test')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('model.config_test')
  test(@Body() dto: TestChannelDto) {
    return this.config.testConnection(dto?.modality ?? 'image');
  }

  /**
   * 批量连通性测试 —— 一次测完所有模态 (2026-10-20)。
   *
   * 三个模态各有独立通道, 逐个点「测试」慢且易漏; 运营改完一个通道
   * 常常忘了另一个, 而「没配」在界面上是看不出来的 (视频/文本无本地兜底,
   * 未接入 = 调用必然失败)。
   *
   * ⚠️ 与单模态测试一样**只探测, 不发真实生成任务** ——
   * 不消耗模型额度, 不产生垃圾产出。
   */
  @Post('test-all')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('model.config_test')
  testAll() {
    return this.config.testAllConnections();
  }

  /**
   * 厂商联动填充方案 (2026-10-20 厂商聚合后新增)。
   *
   * 厂商聚合后, 同一家的多个模态共享基址 (如硅基流动的图与文都是
   * api.siliconflow.cn), 但配置项仍按模态分开 (存量键不改名)。
   * 故由后端一次性给出「选这家厂商 → 各模态填什么」, 前端一次填完,
   * 免得运营手动在三个模态里填同一个基址。
   *
   * ⚠️ **只返回基址/协议/模型, 不返回令牌** —— 凭据仍按模态分开配置
   * (用户可能给图和文用不同的 key), 强行合并会覆盖合法配置。
   */
  @Get('vendor/:key/fill-plan')
  @RequirePermission(PERMISSIONS.modelConfigRead)
  vendorFillPlan(@Param('key') key: string) {
    return this.config.vendorFillPlan(key);
  }
}

/**
 * 模型调用记录 (后台「模型调用记录」页)。
 *
 * **只读**: 不提供任何删除接口 (与审计日志同取向)。
 */
@Controller('admin/model-calls')
export class AdminModelCallsController {
  constructor(private readonly calls: ModelCallService) {}

  /** 调用流水 + 聚合统计 + 筛选项 (筛选项从实际数据聚合, 避免前端硬编码过期清单) */
  @Get()
  @RequirePermission(PERMISSIONS.modelCallRead)
  list(@Query() query: ModelCallListQueryDto) {
    return this.calls.list(query);
  }

  /** 单条详情 (含完整提示词) */
  @Get(':id')
  @RequirePermission(PERMISSIONS.modelCallRead)
  async detail(@Param('id') id: string) {
    const item = await this.calls.detail(id);
    if (!item) throw new AppError(40400, '调用记录不存在', 404);
    return item;
  }
}