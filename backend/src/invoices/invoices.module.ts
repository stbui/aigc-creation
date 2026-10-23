import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/**
 * 发票模块。
 *
 * 依赖 StorageModule 保存可打印 HTML, 依赖全局的 ChannelsModule 发开具通知。
 * AdminModule 复用本模块导出的 InvoicesService 做审核/开具。
 */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
