import { Inject, Injectable, Logger } from '@nestjs/common';
import { writeFile, unlink, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Jimp } from 'jimp';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { IMAGE_PROVIDER, VIDEO_PROVIDER } from '../providers/providers.module';
import { ImageProvider } from '../providers/image-provider.interface';
import type { VideoProvider } from '../providers/unified/unified.provider';
import { getCapability, sanitizeParams } from '../capabilities/capability.registry';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { StorageService } from '../storage/storage.service';
import { MembershipService } from '../membership/membership.service';
import { CreditService } from '../credits/credit.service';
import { CreditPriceService } from '../credits/credit-price.service';
import { resolveUploadsDir } from '../config/env-files';
import type { StorageBackend } from '../storage/storage.provider';

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IMAGE_PROVIDER) private readonly provider: ImageProvider,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
    private readonly storage: StorageService,
    private readonly membership: MembershipService,
    private readonly credit: CreditService,
    private readonly price: CreditPriceService,
  ) {}

  async createTask(ownerId: string, dto: CreateGenerationDto) {
    /*
     * 会员并发上限校验 (落地页承诺「同时处理多个任务」)。
     *
     * ⚠ 必须在**扣费与建任务之前**: 校验失败却已经扣了积分, 用户会为一次
     * 根本没创建的生成付费。顺序错了就是资损。
     */
    const concurrency = await this.membership.checkConcurrency(ownerId);
    if (concurrency.limit > 0) {
      this.logger.debug(`并发校验: ${concurrency.current}/${concurrency.limit}`);
    }

    /*
     * 会员「专享快速通道」标记 (落地页承诺「专享快速生成通道 2K/4K」)。
     *
     * 传参而非改全局配置 —— route 是按能力配置的运营决策, 会员只应在
     * 该能力允许远程时优先走远程, 不能把 local 强制改成 remote。
     * 具体如何影响路由由 CapabilityRouterProvider 决定。
     */
    const memberPerks = await this.membership.perksOf(ownerId);

    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project || project.ownerId !== ownerId) {
      throw new AppError(40001, '项目不存在或无权限', 403);
    }

    const def = getCapability(dto.capability);
    if (!def) {
      throw new AppError(40001, `不支持的能力: ${dto.capability}`, 400);
    }
    if (def.mode === 'planned') {
      throw new AppError(40001, `${def.name} 尚未开放`, 400);
    }
    // 输入图数量按 registry 声明校验 (爆款复刻需要两张: 商品图 + 参考图)
    if (dto.inputAssetIds.length < def.inputs) {
      throw new AppError(
        40001,
        `${def.name} 需要上传 ${def.inputs} 张图片（当前 ${dto.inputAssetIds.length} 张）`,
        400,
      );
    }

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: dto.inputAssetIds }, ownerId, projectId: dto.projectId },
    });
    if (assets.length !== dto.inputAssetIds.length) {
      throw new AppError(40001, '部分输入素材不存在或无权限', 400);
    }

    /*
     * ★ 扣费 (commerce-design.md C5)。
     *
     * 位置三重约束, 顺序错了都是资损:
     *   1. 在**所有校验之后** —— 校验失败却已扣费, 用户为一次根本没创建的
     *      生成付费。上面的并发/项目/能力/素材校验任一失败都必须不扣分。
     *   2. 在**建任务之前** —— 反过来则出现"有任务没扣钱", 白送算力。
     *   3. 余额不足在此抛 402, 不进入建任务 —— 任务不会残留成孤儿。
     *
     * cost 取自 CreditPriceService (后台可改), 不直读 def.creditCost。
     */
    const cost = await this.price.resolve(dto.capability);
    if (cost > 0) {
      try {
        await this.credit.consume({ userId: ownerId, credits: cost });
      } catch (e) {
        // 余额不足由 CreditService 抛 40002; 转成 402 语义更准确 (Payment Required),
        // 前端据此展示「去充值」而非「参数错误」
        if (e instanceof AppError && e.code === 40002) {
          throw new AppError(40201, e.message, 402);
        }
        throw e;
      }
    }

    let task;
    try {
      task = await this.prisma.generationTask.create({
        data: {
          projectId: dto.projectId,
          ownerId,
          capability: dto.capability,
          status: 'running',
          inputAssetIds: JSON.stringify(dto.inputAssetIds),
          /*
           * 参数按 registry 收敛 (越界裁剪 / enum 回落默认值), 避免离谱数值打挂图像处理。
           *
           * `__memberFastChannel` 是会员权益标记: 随参数一起落库, 供异步执行阶段读取。
           * 放进 params 而非加字段 —— 它是"本次生成用到的权益快照",
           * 属任务上下文的一部分, 与用户当时的其它参数同等性质。
           */
          params: JSON.stringify({
            ...sanitizeParams(dto.capability, dto.params),
            __memberFastChannel: memberPerks.fastChannel,
          }),
          provider: 'mock',
          // 扣费快照: 后台重试据此核算, 退款按此值比对。改价不影响已扣的任务。
          creditCost: cost,
        },
      });
    } catch (e) {
      /*
       * 建任务失败必须退还 —— 否则出现「扣了积分但没有任务」, 用户白付一次。
       * 这是扣费与建任务**不能同事务**的代价: CreditService.consume 自带事务,
       * 这里只做失败补偿。补偿失败要显式告警, 静默吞掉等于凭空吞积分。
       */
      if (cost > 0) {
        try {
          await this.credit.grant({
            userId: ownerId,
            credits: cost,
            source: 'grant',
            reason: '建任务失败自动退还',
          });
          this.logger.warn(`建任务失败已退还 ${cost} 积分: user=${ownerId} capability=${dto.capability}`);
        } catch (re) {
          this.logger.error(
            `★资损: 建任务失败且退还失败 user=${ownerId} cost=${cost}: ${(re as Error).message}`,
          );
        }
      }
      throw e;
    }

    // 异步处理: 立即返回任务句柄, 由后台完成生成
    this.enqueue(task.id);

    return { taskId: task.id, status: task.status, creditCost: cost };
  }

  /**
   * 把任务投进执行队列 (admin-prd.md B-32 重试复用)。
   *
   * 公开而非让调用方自己写 setImmediate: 调度时机 (宏任务, 让 HTTP 响应
   * 先出去) 与「失败不冒泡」这两个语义必须一致, 散落在两处迟早漂移。
   */
  enqueue(taskId: string): void {
    setImmediate(() => {
      void this.processTask(taskId);
    });
  }

  private async processTask(taskId: string): Promise<void> {
    // 临时目录在 finally 清理: 生成失败时也必须删, 否则 /tmp 会持续堆积
    const tempDir = await mkdtemp(join(tmpdir(), 'huojue-gen-'));
    try {
      const task = await this.prisma.generationTask.findUnique({ where: { id: taskId } });
      if (!task) return;

      const inputIds: string[] = JSON.parse(task.inputAssetIds || '[]');
      const assets = await this.prisma.asset.findMany({ where: { id: { in: inputIds } } });
      // Prisma 的 in 查询不保证返回顺序, 而多图能力 (爆款复刻: 商品图/参考图)
      // 依赖提交顺序语义, 这里按 inputAssetIds 原序重排, 保证 [0]=商品图 [1]=参考图
      const assetById = new Map(assets.map((a) => [a.id, a]));
      /*
       * 输入素材走存储层读取。
       *
       * ⚠ 不能再按 sourceUrl 拼本地磁盘路径 —— 素材可能存在 OSS/MinIO 上,
       * 本地磁盘上根本没有这个文件。这里从对应后端读出Buffer 后物化到临时目录,
       * 因为 ImageProvider.generate() 的契约是磁盘路径 (jimp 与网关SDK 都要路径),
       * 改接口会波及全部 provider 实现, 收益不抵成本。
       */
      const inputAssets = inputIds
        .map((id) => assetById.get(id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a));

      const inputPaths: string[] = [];
      for (const a of inputAssets) {
        const buf = await this.readAssetBytes(a);
        const tmpPath = join(tempDir, `${a.id}${extOf(a.sourceUrl)}`);
        await writeFile(tmpPath, buf);
        inputPaths.push(tmpPath);
      }

      const params = JSON.parse(task.params || '{}');
      /*
       * 产出按模态分流 (2026-10-20 视频通道落地)。
       *
       * ⚠️ **不能对视频走图像 provider**: 图像通道产出 ImageOutcome
       * (buffer + mime), 而视频要走四段式异步契约, 且没有本地兜底。
       * 分流依据是**能力自己声明的 modality** —— 那是「这项能力产出什么」
       * 的唯一事实源, 不靠能力 id 前缀猜 (那会在新增能力时静默走错通道)。
       */
      const def = getCapability(task.capability);
      const modality = def?.modality ?? 'image';
      const outcome =
        modality === 'video'
          ? await this.videoProvider.generate(task.capability, inputPaths, params)
          : await this.provider.generate(task.capability, inputPaths, params);
      const { buffer, format } = outcome;
      const isVideo = outcome.kind === 'video';

      /*
       * 终止检查点 (admin-prd.md B-33)。
       *
       * ⚠ 模型调用期间 (可达 GATEWAY_TIMEOUT_MS=120s) 管理员可能已把任务
       * 终止。若不检查, 这里会继续建产出图并把状态改回 succeeded ——
       * 运营看到「已终止」却拿到产出图, 后台的作废动作等于没生效。
       *
       * 读库判断而非内存标记: 终止是另一个请求写入的, 内存里看不到。
       * 检查放在**产出落库之前**, 保证不产生孤儿素材。
       */
      const current = await this.prisma.generationTask.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      if (current?.status !== 'running') {
        this.logger.warn(`任务 ${taskId} 已被终止 (当前状态 ${current?.status}), 丢弃本次产出`);
        /*
         * 被后台终止同样要退还 —— 用户既没拿到图也没了积分。
         * 归还是按 creditCost 快照退, 而非重新取价: 任务创建与终止之间
         * 运营可能已改过价, 按新价退会凭空多退或少退。
         */
        await this.refundForFailure(task.ownerId, task.creditCost, taskId, 'cancelled_by_admin');
        return;
      }

      // 产出来源落库: gateway=真实模型通道, local=本地算法。前端据此如实显示,
      // 不把本地算法的产出标成模型结果。
      const source = outcome.source;
      const actualProvider = source === 'gateway' ? 'gateway' : 'local';
      if (task.provider !== actualProvider) {
        await this.prisma.generationTask.update({
          where: { id: taskId },
          data: { provider: actualProvider },
        });
      }

      // 产出走存储层: 写进当前默认后端, 并记录写入时的后端与 key
      // ⚠️ 扩展名按 mime 推导, 不再默认 jpg —— 视频会以 .mp4 落盘,
      // 若仍存成 .jpg 则存储后端按扩展名推断 Content-Type 会发错 MIME,
      // 浏览器按图片解码视频 → 播放失败。
      const ext = extOfFormat(format);
      const storage = this.storage.getActive();
      const key = this.storage.buildKey('generated', ext);
      const stored = await storage.put(key, buffer, format);
      const url = await storage.url(key);

      /*
       * 宽高按模态读取: 图像用 Jimp 解; 视频**不解** (Jimp 不支持 mp4)。
       *
       * 视频的宽高与时长改由 provider 回报 (MiniMax 轮询响应带
       * video_width/video_height), 这里记 durationMs。
       */
      const dims = isVideo ? { width: null, height: null } : await readImageDims(buffer);

      const asset = await this.prisma.asset.create({
        data: {
          projectId: task.projectId,
          ownerId: task.ownerId,
          kind: 'generated',
          capability: task.capability,
          sourceUrl: url,
          width: dims.width,
          height: dims.height,
          format,
          sizeBytes: stored.sizeBytes,
          // 视频时长 (毫秒); 图像/文本产出为 null (不是 0 —— 0 长视频不存在)
          durationMs: isVideo ? (outcome.durationMs ?? null) : null,
          storageBackend: storage.backend,
          storageKey: key,
        },
      });

      await this.prisma.generationTask.update({
        where: { id: taskId },
        data: { status: 'succeeded', outputAssetId: asset.id },
      });
    } catch (err) {
      this.logger.error(`generation failed for task ${taskId}`, err);
      /*
       * ⚠ 不能无条件写 failed + 42201: 若失败原因是管理员刚刚终止
       * (errorCode='cancelled_by_admin'), 覆盖成 42201 会让运营看到的
       * 终止原因凭空消失, 排障时误判为模型故障。
       *
       * 已终结的任务 (succeeded/failed) 同样不再改写 —— 迟到的异常
       * 不该推翻已经落定的结果。
       *
       * ★ updateMany 返回的 count 是**退还的闸**: 只有真正由 running 改写为
       * failed 的那一次调用才退。count=0 说明状态已被别人改掉 (通常是后台终止),
       * 此时若也退, 终止路径与本路径会对同一任务各退一次 → 双倍退款资损。
       */
      const claimed = await this.prisma.generationTask
        .updateMany({
          where: { id: taskId, status: 'running' },
          data: { status: 'failed', errorCode: '42201' },
        })
        .catch(() => ({ count: 0 }));

      if (claimed.count > 0) {
        const failed = await this.prisma.generationTask.findUnique({
          where: { id: taskId },
          select: { ownerId: true, creditCost: true },
        });
        await this.refundForFailure(
          failed?.ownerId ?? '',
          failed?.creditCost ?? 0,
          taskId,
          'generation_failed',
        );
      }
    } finally {
      // 无论成功失败都清理临时目录 —— 生成失败时堆积同样致命
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * 生成失败 / 被终止时退还积分。
   *
   * ⚠ **退到新批次而非原批次**: 原批次可能带过期日, 退回到即将过期的批次
   * 等于让用户白付 —— 他拿回了积分, 但两天后就过期了。
   * 故 grant 不传 validDays, 新批次 expireAt=null (永久), 语义上等价于「从未扣过」。
   *
   * @param cost 按建任务时的**快照**退, 不重新取价: 生成期间运营可能改过价,
   *             按新价退会凭空多退或少退。
   */
  private async refundForFailure(
    userId: string,
    cost: number,
    taskId: string,
    reason: 'generation_failed' | 'cancelled_by_admin',
  ): Promise<void> {
    if (!userId || cost <= 0) return;
    try {
      await this.credit.grant({
        userId,
        credits: cost,
        source: 'grant',
        // 不传 validDays → 永久批次
        reason: reason === 'cancelled_by_admin' ? '任务被终止自动退还' : '生成失败自动退还',
      });
      this.logger.log(`已退还 ${cost} 积分: task=${taskId} user=${userId} 原因=${reason}`);
    } catch (e) {
      // 退还失败是资损, 必须显式告警而非静默
      this.logger.error(
        `★资损: 退还失败 task=${taskId} user=${userId} cost=${cost}: ${(e as Error).message}`,
      );
    }
  }

  async getTask(ownerId: string, id: string) {
    const task = await this.prisma.generationTask.findUnique({ where: { id } });
    if (!task || task.ownerId !== ownerId) {
      throw new AppError(40001, '任务不存在或无权限', 403);
    }

    const output = task.outputAssetId
      ? await this.prisma.asset.findUnique({ where: { id: task.outputAssetId } })
      : null;

    return {
      id: task.id,
      projectId: task.projectId,
      capability: task.capability,
      status: task.status,
      inputAssetIds: JSON.parse(task.inputAssetIds || '[]'),
      params: JSON.parse(task.params || '{}'),
      provider: task.provider,
      errorCode: task.errorCode,
      // 本次实际扣掉的积分快照: 前端结果卡据此显示"本次消耗 N 积分",
      // 与建任务时的价一致, 不受后续改价影响
      creditCost: task.creditCost,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      outputAsset: output
        ? {
            id: output.id,
            sourceUrl: output.sourceUrl,
            capability: output.capability,
            width: output.width,
            height: output.height,
            format: output.format,
            // 视频时长 (毫秒) —— 仅视频产出有值 (2026-10-20)
            durationMs: output.durationMs ?? null,
            /*
             * 产出模态 —— 前端据此选 `<img>` 还是 `<video>`。
             *
             * ⚠️ 由 **mime** 推导而非查能力注册表: 产出形态是文件的真实
             * 形态, 不该由"当初打算产出什么"决定 (能力可能已改版, 而
             * 历史产出仍是旧形态)。用 format 前缀判断最诚实。
             */
            modality: output.format?.startsWith('video/') ? 'video' : 'image',
          }
        : null,
    };
  }

  /** 删除作品: 连带删除其产出的生成图与磁盘文件 (作品=任务+产物) */
  async removeTask(ownerId: string, id: string) {
    const task = await this.prisma.generationTask.findUnique({
      where: { id },
      include: { outputAsset: true },
    });
    if (!task || task.ownerId !== ownerId) {
      throw new AppError(40001, '任务不存在或无权限', 403);
    }

    await this.prisma.generationTask.delete({ where: { id } });

    let removedAsset = false;
    if (task.outputAsset) {
      await this.prisma.asset
        .delete({ where: { id: task.outputAsset.id } })
        .catch(() => undefined);
      removedAsset = true;
    }

    // 磁盘文件: 复用 assets 模块的路径推导规则, 失败不阻塞 (库已删, 留文件无害)
    const src = task.outputAsset?.sourceUrl;
    if (src && src.startsWith('/uploads/')) {
      const parts = src.replace(/^\/uploads\//, '').split('/').filter(Boolean);
      if (parts.length === 2 && !parts.some((p) => p.includes('..'))) {
        await unlink(join(resolveUploadsDir(), parts[0], parts[1])).catch(() => undefined);
      }
    }

    return { id, removedAsset };
  }

  async listTasks(ownerId: string, projectId?: string) {
    const where: Prisma.GenerationTaskWhereInput = { ownerId };
    if (projectId) where.projectId = projectId;

    const tasks = await this.prisma.generationTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // 前端 HistoryList 依赖 outputAsset.sourceUrl 渲染缩略图,
      // 故列表与详情保持同一形状 (outputAssetId 上有唯一索引, include 为 1:1 无 N+1)
      include: { outputAsset: true },
    });

    return tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      capability: t.capability,
      status: t.status,
      inputAssetIds: JSON.parse(t.inputAssetIds || '[]'),
      params: JSON.parse(t.params || '{}'),
      provider: t.provider,
      errorCode: t.errorCode,
      creditCost: t.creditCost,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      outputAsset: t.outputAsset
        ? {
            id: t.outputAsset.id,
            sourceUrl: t.outputAsset.sourceUrl,
            capability: t.outputAsset.capability,
            width: t.outputAsset.width,
            height: t.outputAsset.height,
            format: t.outputAsset.format,
            // 视频时长 (毫秒) —— 仅视频产出有值 (2026-10-20)
            durationMs: t.outputAsset.durationMs ?? null,
            // 产出模态 —— 前端据此选 `<img>` 还是 `<video>` (按 mime 推导)
            modality: t.outputAsset.format?.startsWith('video/') ? 'video' : 'image',
          }
        : null,
    }));
  }

  /**
   * 按素材记录的后端读取字节。
   *
   * 存量数据可能没有 storageKey (迁移脚本跑之前生成的), 这时回退到
   * 从 sourceUrl 剥离 /uploads/ 前缀推断 —— 与迁移脚本同一条规则。
   */
  private async readAssetBytes(a: {
    storageKey: string | null;
    storageBackend: string;
    sourceUrl: string;
  }): Promise<Buffer> {
    const backend = (a.storageBackend as StorageBackend) ?? 'local';
    const provider = this.storage.get(backend);
    const key = a.storageKey ?? a.sourceUrl.replace(/^\/uploads\//, '');

    if (provider && (await provider.exists(key))) {
      return provider.get(key);
    }
    // 回退: 本地磁盘直读 (存量数据或云端文件已丢时的兜底)
    const { readFile } = await import('fs/promises');
    return readFile(join(resolveUploadsDir(), key));
  }
}

/** 从 sourceUrl 推断扩展名, 供临时文件命名 */
function extOf(sourceUrl: string): string {
  const m = sourceUrl.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  return m ? `.${m[1]}` : '.jpg';
}

/**
 * mime → 存储扩展名 (2026-10-20 视频通道落地)。
 *
 * ⚠️ 不能再用「png 用 png, 其余一律 jpg」: 视频会被存成 .jpg,
 * 存储后端按扩展名推断 Content-Type 就会发 image/jpeg,
 * 浏览器按图片解码视频 → 播放失败 (表现为"生成成功但视频打不开")。
 *
 * 未知 mime 回落 jpg —— 与改造前行为一致, 不引入新的未知分支。
 */
function extOfFormat(format: string): string {
  const m = /^([a-z0-9.+-]+)\//i.exec(format);
  const sub = m?.[1]?.toLowerCase();
  switch (sub) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/x-msvideo':
      return 'avi';
    default:
      return 'jpg';
  }
}

/**
 * 读图片宽高 (2026-10-20 视频通道落地)。
 *
 * 单独抽成函数而不是内联, 是为了让**视频路径完全不碰 Jimp** ——
 * Jimp 喂 mp4 会抛 "Unsupported MIME type", 视频任务会永远失败。
 */
async function readImageDims(buffer: Buffer): Promise<{ width: number; height: number }> {
  const img = await Jimp.read(buffer);
  return { width: img.bitmap.width, height: img.bitmap.height };
}
