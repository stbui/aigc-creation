/**
 * 后台「能力与模型」：能力绑定、能力定价、路由模拟。
 *
 * 前台模型层删除后，这里取代 `/admin/logical-models/*`：
 *   · `GET/PUT /admin/capabilities/:id/models`   候选池
 *   · `GET/PUT /admin/capabilities/:id/pricing`  能力售价
 *   · `POST    /admin/capabilities/:id/simulate` 选路模拟
 *   · `POST    /admin/capabilities/:id/models/prune-invalid` 清理单个能力的失效绑定
 *   · `POST    /admin/capability-models/prune-invalid`         跨能力清理失效绑定
 *   · `GET     /admin/channel-models/:id/capabilities` 商品兼容预览
 *   · `POST    /admin/channel-models/:id/publish`      商品绑定到能力
 */

import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Allow, IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { AdminUser, RequirePermission } from '../../admin/admin.decorator';
import { PERMISSIONS } from '../../admin/permissions';
import { UserGroupService } from '../user-groups/user-group.service';
import {
  CapabilityModelAdminService,
  type BindingInput,
  type PricingInput,
} from './capability-model.admin.service';

export class ReplaceBindingsDto {
  @IsArray()
  bindings!: BindingInput[];

  @IsOptional() @IsString() reason?: string;
}

export class CapabilityPricingDto implements PricingInput {
  @IsOptional() @IsString() billingMode?: string;
  @IsOptional() @IsNumber() unitPriceMicrocredits?: number | string;
  @IsOptional() @IsNumber() inputTokenPriceMicrocredits?: number | string;
  @IsOptional() @IsNumber() outputTokenPriceMicrocredits?: number | string;
  @IsOptional() @IsNumber() cachedTokenPriceMicrocredits?: number | string;
}

export class SimulateDto {
  @IsOptional() @IsString() modelKey?: string;
  @IsOptional() @Allow() inputs?: unknown;
  @IsOptional() @Allow() options?: unknown;
}

export class PublishDto {
  @IsArray() capabilities!: string[];
  @IsOptional() @IsString() reason?: string;
}

export class BindingItemDto implements BindingInput {
  @IsString() channelModelId!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() priority?: number;
  @IsOptional() @IsNumber() weight?: number;
}

@Controller('admin')
export class AdminCapabilityModelsController {
  constructor(
    private readonly service: CapabilityModelAdminService,
    private readonly groups: UserGroupService,
  ) {}

  @Get('capability-models/consumption')
  @RequirePermission(PERMISSIONS.logicalModelRead)
  consumption() {
    return this.service.consumption();
  }

  @Get('capabilities/:id/models')
  @RequirePermission(PERMISSIONS.logicalModelRead)
  list(@Param('id') id: string) {
    return this.service.list(id);
  }

  @Put('capabilities/:id/models')
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  replace(@Param('id') id: string, @Body() dto: ReplaceBindingsDto) {
    return this.service.replace(id, dto.bindings);
  }

  @Post('capabilities/:id/models/prune-invalid')
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  pruneInvalid(@Param('id') id: string) {
    return this.service.pruneInvalid(id);
  }

  @Post('capability-models/prune-invalid')
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  pruneAllInvalid() {
    return this.service.pruneAllInvalid();
  }

  @Get('capabilities/:id/pricing')
  @RequirePermission(PERMISSIONS.productPrice)
  pricing(@Param('id') id: string) {
    return this.service.getPricing(id);
  }

  @Put('capabilities/:id/pricing')
  @RequirePermission(PERMISSIONS.productPrice)
  setPricing(
    @Param('id') id: string,
    @Body() dto: CapabilityPricingDto,
    @AdminUser() user: { id: string; email: string },
  ) {
    return this.service.setPricing(id, dto, user.email);
  }

  @Post('capabilities/:id/simulate')
  @RequirePermission(PERMISSIONS.logicalModelRead)
  async simulate(
    @Param('id') id: string,
    @Body() dto: SimulateDto,
    @AdminUser() user: { id: string },
  ) {
    const access = await this.groups.accessForUser(user.id);
    return this.service.simulate(access, id, dto);
  }

  @Get('channel-models/:id/capabilities')
  @RequirePermission(PERMISSIONS.channelModelRead)
  compatibility(@Param('id') id: string) {
    return this.service.compatibility(id);
  }

  @Post('channel-models/:id/publish')
  @RequirePermission(PERMISSIONS.logicalModelWrite)
  publish(@Param('id') id: string, @Body() dto: PublishDto) {
    return this.service.publish(id, dto.capabilities);
  }
}
