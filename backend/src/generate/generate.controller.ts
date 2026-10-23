import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { GenerateService } from './generate.service';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { RateLimit } from '../common/rate-limit.guard';

@Controller('generate')
@UseGuards(JwtAuthGuard)
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  /*
   * 生成限流按**用户**计：换 IP 不该换来更多额度 —— 每名额度的成本是模型
   * 调用与积分，而积分是用户自己的。20 次/分钟足够覆盖任何手工操作节奏。
   */
  @RateLimit({ name: 'generate', limit: 20, windowSec: 60, scope: 'user' })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGenerationDto) {
    return this.generateService.createTask(user.id, dto);
  }
}
