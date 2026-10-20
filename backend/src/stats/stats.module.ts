import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /** 数据中心总览 */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.statsService.overview(user.id);
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
