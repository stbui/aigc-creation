import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * 商品模块 (只读 C 端)。
 *
 * 写入侧在 admin (AdminCommerceController), 本模块不提供写方法 ——
 * 少一个入口就少一条「谁能改价」的排查路径。
 */
@Module({
  imports: [PrismaModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}