import { Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';

/** 未单独指定时长时，缓存项的默认存活时间 */
const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * 进程内缓存（@nestjs/cache-manager + Keyv 内存 store）。
 *
 * 为什么统一到一个模块：缓存原本散落在各 service 里手写 `{ at, value }`，
 * 失效、TTL 与键空间各写一套，既无法整体观测，也很难在多实例部署时换掉
 * 存储。这里注册一次，业务侧只注入 `CACHE_MANAGER`。
 *
 * 边界（写新缓存前先读）：
 *   1. 只缓存**可重建、丢失无副作用**的读投影。任务状态、账单、积分与权限
 *      事实仍以数据库为准，缓存只做短 TTL 加速。
 *   2. key 必须带域前缀（`admin:` / `aigc-label:` / `health:` …），避免撞键；
 *      `set` 时显式传 TTL，不要依赖默认值表达业务语义。
 *   3. 单实例语义：多实例部署时各进程独立，缓存只影响新鲜度。写操作必须
 *      **显式 del** 对应 key，不能只等 TTL 过期。
 *   4. 当前是内存 store，可直接保存 Map / Date / Buffer 等引用类型。切换 Redis
 *      （见 docs/canvas-detailed-design.md）时除了改 stores，还要把缓存值改成
 *      可序列化结构，否则取回的是普通对象而不是 Map / Buffer。
 */
@Module({
  imports: [
    NestCacheModule.register({
      // 官方约定：动态全局模块用 isGlobal 声明，不再套 @Global() 或手动导出
      isGlobal: true,
      ttl: DEFAULT_CACHE_TTL_MS,
    }),
  ],
})
export class CacheModule {}
