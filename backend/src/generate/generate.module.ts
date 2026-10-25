import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProvidersModule } from '../providers/providers.module';
import { MembershipModule } from '../membership/membership.module';
import { CreditsModule } from '../credits/credits.module';
import { CapabilitiesModule } from '../capabilities/capabilities.module';
import { AigcLabelModule } from '../aigc-label/aigc-label.module';
import { PromptToolsModule } from '../prompt-tools/prompt-tools.module';
import { GenerateService } from './generate.service';
import { GenerateController } from './generate.controller';
import { TasksController } from './tasks.controller';

@Module({
  // CreditsModule: 建任务前扣费 + 失败退还 (CreditService), 以及取运行时消耗价 (CreditPriceService)。
  // CreditsModule 不依赖本模块, 因此无循环。
  imports: [
    PrismaModule,
    ProvidersModule,
    MembershipModule,
    CreditsModule,
    CapabilitiesModule,
    // 可见 AIGC 角标的样式与位图（后台可配）。只读依赖，无循环
    AigcLabelModule,
    // 局部重绘的参考图会先转成文字描述再并入提示词；只读依赖，无循环
    PromptToolsModule,
  ],
  controllers: [GenerateController, TasksController],
  providers: [GenerateService],
  // 导出供 AdminModule 的任务重试 (B-32) 复用: 重试要新建任务并触发
  // processTask, 而 processTask 的调度语义封装在 enqueue() 里。
  // GenerateModule 不反向依赖 AdminModule, 因此无循环。
  exports: [GenerateService],
})
export class GenerateModule {}
