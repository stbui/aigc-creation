import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * 存储模块。
 *
 * 设为 @Global: 素材服务、生成服务、后台素材服务都要用同一份 StorageService,
 * 而它们分属不同业务模块。全局化省去逐个imports 传递, 也避免出现多实例
 * (多实例会导致 setActive 在一处生效、另一处读不到)。
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
