import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CapabilityRouterProvider } from './capability-router.provider';
import { TextCapabilityRouter } from './text-capability-router.provider';
import { VideoCapabilityRouter } from './video-capability-router.provider';
import { ChannelScheduler } from './channel-scheduler';
import { ChannelRepository } from './channel-repository';
import { ImageCallLogger } from './image-call-logger';
import { ImageProvider } from './image-provider.interface';
import { TextProvider } from './text-provider.interface';
import { VideoProvider } from './unified/unified.provider';

export const IMAGE_PROVIDER = 'IMAGE_PROVIDER';
export const TEXT_PROVIDER = 'TEXT_PROVIDER';
export const VIDEO_PROVIDER = 'VIDEO_PROVIDER';

/**
 * IMAGE_PROVIDER 绑定的是**能力路由器** (不是某个具体 provider):
 *   route=remote/auto 且网关可用 → 真实模型通道
 *   否则 / 通道失败              → 本地 Jimp 算法
 * 因此 15 项能力(含原 7 项本地算法)都能单独切到真模型, 且外部服务故障不影响可用性。
 *
 * TEXT_PROVIDER 绑定的是文生文路由器 (2026-10-20, 与图像平级):
 * 它**没有本地兜底** —— 文本没有「本地算法」可言, 编一段模板文案会让用户
 * 误以为是模型产出。失败即失败, 由调用方如实呈现。
 *
 * VIDEO_PROVIDER 绑定的是视频路由器 (2026-10-20, 与前两者平级):
 * 同样**没有本地兜底** —— 本地不存在「本地生成视频」这回事。
 * 与文本的差别是视频走的是**四段式异步契约** (提交 → 轮询 → 取文件 → 下载),
 * 故独立成路由器而非复用图像基座。
 *
 * 每次生成都会写一条 ModelCallLog (耗时/成败/回落原因), 由 ImageCallLogger 承担。
 * 它是旁路观测: 写失败只打 WARN, 绝不影响出图。
 * ⚠️ 该埋点现覆盖图像/文本/视频三个模态 (ModelCallLog.modality 记录是哪个)。
 */
@Module({
  // PrismaModule: 路由器需读 ModelChannelConfig (后台可编辑的通道配置),
  // 埋点器需写 ModelCallLog。缺了它整个生成通道无法启动。
  imports: [PrismaModule],
  providers: [
    // 三个路由器同时显式注册: 它们除了作为对应 token 的实现类,
    // 还需要能被其它模块按类注入 (如后台的通道测试端点)。
    // 只写 useClass 而不在 providers 里列出, Nest 会在 export 时抛
    // UnknownExportException —— 导出了不属于本模块的 provider。
    CapabilityRouterProvider,
    TextCapabilityRouter,
    VideoCapabilityRouter,
    // 多渠道调度器 (2026-10-20): 三个路由器共用, 由 Nest 统一注入。
    // ⚠️ 必须显式注册: 只 import 不写 providers 会导致
    // "Nest can't resolve dependencies of the CapabilityRouterProvider"
    ChannelScheduler,
    // 多渠道仓库: 后台线路 CRUD 与调度快照的唯一入口。
    ChannelRepository,
    { provide: IMAGE_PROVIDER, useExisting: CapabilityRouterProvider },
    { provide: TEXT_PROVIDER, useExisting: TextCapabilityRouter },
    { provide: VIDEO_PROVIDER, useExisting: VideoCapabilityRouter },
    ImageCallLogger,
  ],
  exports: [
    IMAGE_PROVIDER,
    TEXT_PROVIDER,
    VIDEO_PROVIDER,
    ImageCallLogger,
    CapabilityRouterProvider,
    TextCapabilityRouter,
    VideoCapabilityRouter,
    ChannelScheduler,
    ChannelRepository,
  ],
})
export class ProvidersModule {}