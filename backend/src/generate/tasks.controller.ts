import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { GenerateService } from './generate.service';

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
  listPage(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('capability') capability?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const n = Number(limit ?? 50);
    const skip = Number(offset ?? 0);
    return this.generateService.listTasksPage(user.id, {
      projectId,
      capability,
      limit: Number.isFinite(n) ? n : 50,
      offset: Number.isFinite(skip) ? skip : 0,
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
