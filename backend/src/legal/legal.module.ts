import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * 法务域。
 *
 * `LegalService` 导出给三处用：公开 controller、后台版本管理、
 * 以及注册/下单写 `ConsentRecord` 时的版本解析。
 */
@Module({
  imports: [PrismaModule],
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
