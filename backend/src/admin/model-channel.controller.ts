import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AuditAction, RequirePermission } from './admin.decorator';
import { PERMISSIONS } from './permissions';
import { ModelChannelService } from './model-channel.service';
import {
  CreateModelChannelDto,
  ListModelChannelModelsDto,
  MaterializeModelChannelDto,
  MoveModelChannelDto,
  TestAllModelChannelsDto,
  TestModelChannelDraftDto,
  UpdateModelChannelDto,
} from './dto/model-channel.dto';

/**
 * 模型线路（多渠道）管理。
 *
 * 权限分层：
 *   读   model.config_read —— 运营可看状态与健康；
 *   写   channel.route     —— 改线路会影响线上生成，属高危（要求填写原因）；
 *   测试 channel.test      —— 只发探测请求，不写配置、不改健康状态。
 *
 * GET 不审计；写与测试都挂 AuditAction，审计 detail 只记
 * modality/protocol/model/priority 等非敏感字段（token/baseUrl 不进审计）。
 */
@Controller('admin/model-channels')
export class AdminModelChannelsController {
  constructor(private readonly service: ModelChannelService) {}

  /** 三模态线路快照 + 调度来源 + 健康计数 */
  @Get()
  @RequirePermission(PERMISSIONS.modelConfigRead)
  list() {
    return this.service.listAll();
  }

  @Post()
  @RequirePermission(PERMISSIONS.channelRoute)
  @AuditAction('model.channel_create')
  create(@Body() dto: CreateModelChannelDto) {
    return this.service.create(dto);
  }

  /** 把旧版单通道配置固化为可管理线路（幂等） */
  @Post('materialize')
  @RequirePermission(PERMISSIONS.channelRoute)
  @AuditAction('model.channel_materialize')
  materialize(@Body() dto: MaterializeModelChannelDto) {
    return this.service.materialize(dto.modality);
  }

  /** 批量测试：不指定模态时测试三个模态的全部线路 */
  @Post('test-all')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('model.channel_test')
  testAll(@Body() dto: TestAllModelChannelsDto) {
    return this.service.testAll(dto);
  }

  /**
   * 拉取厂商模型清单（预设 + 实时）。
   *
   * 与「草稿测试」同一档权限：都要用令牌向厂商发请求。
   * 只读、不落库、不改健康状态；令牌只在本次请求内使用。
   */
  @Post('models')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('model.channel_models')
  listModels(@Body() dto: ListModelChannelModelsDto) {
    return this.service.listModels(dto);
  }

  /** 草稿测试：未保存的表单值也能验证 */
  @Post('test')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('model.channel_test')
  testDraft(@Body() dto: TestModelChannelDraftDto) {
    return this.service.testDraft(dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.channelRoute)
  @AuditAction('model.channel_update')
  update(@Param('id') id: string, @Body() dto: UpdateModelChannelDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.channelRoute)
  @AuditAction('model.channel_delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/move')
  @RequirePermission(PERMISSIONS.channelRoute)
  @AuditAction('model.channel_move')
  move(@Param('id') id: string, @Body() dto: MoveModelChannelDto) {
    return this.service.move(id, dto);
  }

  /** 测试已保存的某条线路 */
  @Post(':id/test')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('model.channel_test')
  testSaved(@Param('id') id: string) {
    return this.service.testSaved(id);
  }
}
