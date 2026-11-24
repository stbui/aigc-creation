import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { GenerateService } from './generate.service';

/** 任务分页列表查询参数。上限 100 与 service 端收敛值一致 */
export class TaskPageQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  capability?: string;

  /** '1' / 'true' 时过滤失败与已取消任务 */
  @IsOptional()
  @IsString()
  excludeFailed?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(100, { message: 'limit 最大为 100' })
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'offset 必须是整数' })
  @Min(0, { message: 'offset 不能为负' })
  offset?: number;
}

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly generateService: GenerateService) {}

  /**
   * 分页任务列表。
   *
   * ⚠ 必须注册在 `:id` 之前，否则 `/tasks/page` 会被当成 id='page'。
   */
  @Get('page')
  listPage(@CurrentUser() user: AuthUser, @Query() query: TaskPageQueryDto) {
    return this.generateService.listTasksPage(user.id, {
      projectId: query.projectId,
      capability: query.capability,
      excludeFailed: query.excludeFailed === '1' || query.excludeFailed === 'true',
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.generateService.getTask(user.id, id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.generateService.listTasks(user.id, projectId);
  }

  /** 删除作品记录 (同时删除其产出的生成图与磁盘文件) */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.generateService.removeTask(user.id, id);
  }
}
