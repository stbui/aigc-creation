import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { GenerateService } from './generate.service';
import { CreateGenerationDto } from './dto/create-generation.dto';

@Controller('generate')
@UseGuards(JwtAuthGuard)
export class GenerateController {
  constructor(private readonly generateService: GenerateService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGenerationDto) {
    return this.generateService.createTask(user.id, dto);
  }
}
