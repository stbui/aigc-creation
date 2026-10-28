import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { writeFile, unlink, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Jimp, JimpMime } from 'jimp';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { IMAGE_PROVIDER, VIDEO_PROVIDER } from '../providers/providers.module';
import { ImageProvider } from '../providers/image-provider.interface';
import { MaskUnsupportedError, NoModelChannelError } from '../providers/gateway.types';
import type { VideoProvider } from '../providers/unified/unified.provider';
import { getCapability, sanitizeParams, validateCapabilityParams } from '../capabilities/capability.registry';
import { parseLocalRedrawAnnotations } from '../capabilities/definitions/local_redraw';
import {
  multiFusionCreditCost,
  multiFusionOutputDimensions,
} from '../capabilities/definitions/multi_fusion';
import { CapabilityAvailabilityService } from '../capabilities/capability-availability.service';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { StorageService } from '../storage/storage.service';
import { MembershipService } from '../membership/membership.service';
import { CreditService } from '../credits/credit.service';
import { CreditPriceService } from '../credits/credit-price.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AigcVisibleLabelError, labelGeneratedImage, type AigcMeta } from '../common/aigc-label';
import { AigcLabelService } from '../aigc-label/aigc-label.service';
import { PromptToolsService } from '../prompt-tools/prompt-tools.service';
import { SignedUrlService } from '../common/signed-url.service';
import { resolveUploadsDir } from '../config/env-files';
import type { StorageBackend } from '../storage/storage.provider';
import { inspectMaskImage, inspectUploadedImage } from '../assets/image-validation';

/** 任务执行期心跳间隔 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 心跳超过该时长未更新即视为孤儿任务。
 *
 * 心跳每 30s 一次, 所以 10 分钟的静默只可能是执行者已经不在了
 * (进程崩溃 / 被 kill / 容器重建)。任务本身的耗时与此无关 ——
 * 视频任务跑满 10 分钟期间心跳依然在跳。
 */
const ORPHAN_STALE_MS = 10 * 60 * 1000;

/** 单张输入图经过模型与标识流程后的产出。 */
type ImageOutcome = Awaited<ReturnType<ImageProvider['generate']>>;

@Injectable()
export class GenerateService implements OnModuleInit {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IMAGE_PROVIDER) private readonly provider: ImageProvider,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
    private readonly storage: StorageService,
    private readonly membership: MembershipService,
    private readonly credit: CreditService,
    private readonly price: CreditPriceService,
    private readonly notifications: NotificationsService,
    private readonly signedUrl: SignedUrlService,
    private readonly availability: CapabilityAvailabilityService,
    // 可见角标样式（后台「AI 标识」页可配）。读失败会回退默认样式，不影响生成
    private readonly aigcLabel: AigcLabelService,
    private readonly promptTools: PromptToolsService,
  ) {}

  async createTask(ownerId: string, dto: CreateGenerationDto, idempotencyHeader?: string) {
    const idempotencyKey = normalizeIdempotencyKey(dto.idempotencyKey, idempotencyHeader);
    // 幂等命中必须在会员并发/可用性校验之前：重试请求应拿回原任务，
    // 不能因为原任务仍占用并发额度而把重试挡在门外。
    if (idempotencyKey) {
      const existing = await this.prisma.generationTask.findUnique({
        where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
      });
      if (existing) {
        return {
          taskId: existing.id,
          status: existing.status,
          creditCost: existing.creditCost,
          idempotentHit: true,
        };
      }
    }
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
     * 传参而非改全局配置 —— route 是按能力配置的运营决策。本地生成已删除,
     * 会员只会影响远程线路的调度优先级。
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

    validateCapabilityParams(dto.capability, dto.params);
    if (dto.inputAssetIds.length > 10) {
      throw new AppError(40001, '一次最多提交 10 张输入图片', 400);
    }
    if (dto.inputAssetIds.some((id) => !id?.trim())) {
      throw new AppError(40001, '输入素材 id 不能为空', 400);
    }
    if (new Set(dto.inputAssetIds).size !== dto.inputAssetIds.length) {
      throw new AppError(40001, '输入素材不能重复', 400);
    }

    /*
     * 后台上下线管控。
     *
     * 必须在**扣费之前**拦：下线能力如果先扣分再失败，用户会被为一次
     * 根本不存在的服务付费。错误码 40005 与「参数错误(40001)」区分开，
     * 前端据此显示「该能力已下线」而不是「参数填错了」。
     */
    const availability = await this.availability.runtimeOf(dto.capability);
    if (availability && !availability.enabled) {
      throw new AppError(40005, availability.reason || `${def.name} 已暂时下线`, 400);
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
     * 遮罩素材校验（局部重绘，2026-10-22）。
     *
     * 必须在**扣费之前**：遮罩是这次生成的核心输入，传了个不属于自己的 id
     * 却先扣了积分再失败，用户会为一次注定失败的任务付费。
     *
     * 只校验「属于本人 + 是上传素材」：遮罩是前端按原图尺寸现画现传的，
     * 不要求与原图同项目 —— 用户可能先在别的项目里传过同一张底图，
     * 强行要求同项目只会让人莫名其妙地传两遍。
     */
    const maskAssetIdRaw = dto.params?.modelGuideAssetId ?? dto.params?.maskAssetId;
    const maskAssetId = typeof maskAssetIdRaw === 'string' ? maskAssetIdRaw.trim() : '';
    if (maskAssetId) {
      const maskAsset = await this.prisma.asset.findFirst({
        where: { id: maskAssetId, ownerId, kind: 'original' },
        select: { id: true, format: true, width: true, height: true },
      });
      if (!maskAsset) {
        throw new AppError(40001, '遮罩素材不存在或无权限', 400);
      }
      if (maskAsset.format && maskAsset.format !== 'image/png') {
        throw new AppError(40001, '遮罩必须使用 PNG 格式', 400);
      }
      const source = assets.find((asset) => asset.id === dto.inputAssetIds[0]);
      if (
        source?.width &&
        source?.height &&
        maskAsset.width &&
        maskAsset.height &&
        (source.width !== maskAsset.width || source.height !== maskAsset.height)
      ) {
        throw new AppError(
          40001,
          `遮罩尺寸必须与原图一致（原图 ${source.width}×${source.height}，遮罩 ${maskAsset.width}×${maskAsset.height}）`,
          400,
        );
      }
    }

    /*
     * 局部重绘的逐标注参考图校验 (2026-10-25 接入)。
     *
     * 参考图是可选项, 但只要传了 id, 就必须属于本人且是上传素材。
     * 放在扣费前的原因与遮罩一致: 这是生成输入, 不能让用户先付了积分,
     * 再在异步执行阶段才发现某张参考图是无效 id。
     */
    if (dto.capability === 'local_redraw') {
      const rawAnnotations = dto.params?.annotations;
      if (rawAnnotations !== undefined) {
        let decoded: unknown;
        try {
          decoded = typeof rawAnnotations === 'string' ? JSON.parse(rawAnnotations) : rawAnnotations;
        } catch {
          throw new AppError(40001, 'annotations 必须是合法 JSON', 400);
        }
        if (!Array.isArray(decoded) || decoded.length === 0 || decoded.length > 3) {
          throw new AppError(40001, 'annotations 必须是 1 至 3 项数组', 400);
        }
        const annotationsJson = typeof rawAnnotations === 'string' ? rawAnnotations : JSON.stringify(rawAnnotations);
        const parsed = parseLocalRedrawAnnotations(annotationsJson);
        if (parsed.length !== decoded.length) {
          throw new AppError(40001, '每个标注都必须包含非空区域描述', 400);
        }
        // 兼容直接发送 JSON 数组的 API 调用方：落库仍使用字符串，
        // 避免 sanitizeParams 把对象变成 "[object Object]"。
        if (typeof rawAnnotations !== 'string') dto.params!.annotations = annotationsJson;
      }
      const referenceIds = parseLocalRedrawAnnotations(dto.params?.annotations)
        .map((item) => item.referenceAssetId)
        .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
      for (const referenceId of new Set(referenceIds)) {
        const reference = await this.prisma.asset.findFirst({
          where: { id: referenceId, ownerId, kind: 'original' },
          select: { id: true },
        });
        if (!reference) {
          throw new AppError(40001, '局部重绘参考图素材不存在或无权限', 400);
        }
      }
    }

    /*
     * ★ 扣费与建任务 (commerce-design.md C5)。
     *
     * 两者必须在**同一个数据库事务**中:
     *   - 所有业务校验通过后才扣费，校验失败不会产生扣费流水；
     *   - 任务创建失败或幂等唯一键冲突时，扣减与流水一起回滚；
     *   - 余额不足抛 402，事务内不留下半截任务或积分变动。
     *
     * cost 取自 CreditPriceService (后台可改), 不直读 def.creditCost。
     */
    const sanitizedParams = sanitizeParams(dto.capability, dto.params);
    const baseCost = await this.price.resolve(dto.capability);
    const cost =
      dto.capability === 'multi_fusion'
        ? multiFusionCreditCost(
            baseCost,
            sanitizedParams.variantCount,
            sanitizedParams.size,
          )
        : baseCost;

    let task;
    try {
      task = await this.prisma.$transaction(async (tx) => {
        if (cost > 0) {
          try {
            await this.credit.consume({ userId: ownerId, credits: cost }, tx);
          } catch (e) {
            // 余额不足由 CreditService 抛 40002; 转成 402 语义更准确
            // (Payment Required), 前端据此展示「去充值」而非「参数错误」。
            if (e instanceof AppError && e.code === 40002) {
              throw new AppError(40201, e.message, 402);
            }
            throw e;
          }
        }

        return tx.generationTask.create({
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
              ...sanitizedParams,
              __memberFastChannel: memberPerks.fastChannel,
            }),
            idempotencyKey,
            // 初始值 = 尚未执行; 跑完后由 processTask 改写成 gateway / local
            provider: 'pending',
            // 扣费快照: 后台重试据此核算, 退款按此值比对。改价不影响已扣的任务。
            creditCost: cost,
            // 建任务即开始计时, 避免「刚建完就崩溃」的任务没有心跳可判
            heartbeatAt: new Date(),
          },
        });
      });
    } catch (e) {
      /*
       * 幂等竞态：两个相同键的请求都通过了前置查询，数据库唯一约束只允许
       * 一个创建成功。失败方的事务已连同扣费一起回滚，直接返回赢家任务。
       */
      if (idempotencyKey) {
        const existing = await this.prisma.generationTask
          .findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } } })
          .catch(() => null);
        if (existing) {
          return {
            taskId: existing.id,
            status: existing.status,
            creditCost: existing.creditCost,
            idempotentHit: true,
          };
        }
      }
      throw e;
    }

    // 异步处理: 立即返回任务句柄, 由后台完成生成
    this.enqueue(task.id);

    return { taskId: task.id, status: task.status, creditCost: cost, idempotentHit: false };
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
    /*
     * 心跳: 执行期间每 30s 刷新一次。进程若在生成途中被 kill, 心跳停住,
     * `task-recover` 会把这条 running 任务判为孤儿并退款 —— 否则它会永远
     * 挂在 running, 占着会员并发额度, 用户的积分也不回来。
     *
     * unref() 让心跳不阻止进程退出; 失败静默 (心跳写不进去说明库有问题,
     * 由真正的业务查询去报错, 不在这里制造噪音)。
     */
    const heartbeat = setInterval(() => {
      void this.prisma.generationTask
        .updateMany({ where: { id: taskId, status: 'running' }, data: { heartbeatAt: new Date() } })
        .catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    (heartbeat as any).unref?.();
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
      if (task.capability === 'local_redraw') {
        await this.attachLocalRedrawReferenceHints(params, task.ownerId);
      }
      /*
       * 遮罩物化到临时目录（局部重绘）。
       *
       * 遮罩和输入图一样走存储层读字节 —— 它可能落在 OSS/MinIO 上，
       * 按 sourceUrl 拼本地路径会 ENOENT。provider 的契约是磁盘路径。
       *
       * 传不下去时**直接抛**，不要静默退化成「无遮罩」：那会把
       * 「只改涂抹区域」变成「整图重绘」，用户付了积分拿到一张面目全非的图。
       */
      const maskPath = await this.materializeMask(
        params.modelGuideAssetId ?? params.maskAssetId,
        task.ownerId,
        tempDir,
        inputAssets[0],
      );
      /*
       * 产出按模态分流 (2026-10-20 视频通道落地)。
       *
       * ⚠️ **不能对视频走图像 provider**: 图像通道产出 ImageOutcome
       * (buffer + mime), 而视频要走四段式异步契约。
       * 分流依据是**能力自己声明的 modality** —— 那是「这项能力产出什么」
       * 的唯一事实源, 不靠能力 id 前缀猜 (那会在新增能力时静默走错通道)。
       */
      const def = getCapability(task.capability);
      const modality = def?.modality ?? 'image';
      /*
       * 多图融合的“变体张数”必须是真实的多张模型产出。
       *
       * 这里在**同一个任务内**并发调用同一个图像能力 N 次，并给每次调用注入
       * 变体序号；用户只提交一次、只扣一次积分。不能在前端把一张结果复制 N
       * 份冒充变体，也不能因为 N 张就重复扣 N 次用户积分。
       *
       * 部分候选失败时保留成功候选；全部失败才让任务失败并走既有退款逻辑。
       * 结果数量按真实成功数下发，不用重复图补齐。
       */
      const requestedVariants =
        task.capability === 'multi_fusion'
          ? Math.max(1, Math.min(4, Math.floor(Number(params.variantCount) || 1)))
          : 1;
      let outcomes;
      if (modality === 'video') {
        outcomes = [await this.videoProvider.generate(task.capability, inputPaths, params)];
      } else if (requestedVariants > 1) {
        /*
         * 四路同时请求时偶发单路 120s 通道超时，日志表现为 aborted 而非
         * 并发限流。两路分批会把 4 张拓展到约 7 分钟，反而损害体验，故
         * 首批仍按用户选择并发发出，只对失败候选补一次独立调用。
         *
         * 重试仍是独立的模型调用，不复制成功图；二次仍失败时保留已成功
         * 候选，任务只在**全部**候选失败时判失败并退款。
         */
        const results: Array<ImageOutcome | undefined> = new Array(requestedVariants);
        const failures: Array<{ index: number; reason: unknown }> = [];
        const runVariant = async (index: number) => {
          const value = await this.provider.generate(
            task.capability,
            inputPaths,
            { ...params, variantIndex: index + 1, variantTotal: requestedVariants },
            maskPath,
          );
          results[index] = value;
        };

        const runBatch = async (indexes: number[]) => {
          const settled = await Promise.allSettled(indexes.map((index) => runVariant(index)));
          settled.forEach((item, offset) => {
            if (item.status === 'rejected') {
              failures.push({ index: indexes[offset], reason: item.reason });
            }
          });
        };

        await runBatch(Array.from({ length: requestedVariants }, (_, index) => index));

        const failedIndexes = failures.map((item) => item.index);
        if (failedIndexes.length > 0) {
          this.logger.warn(
            `多图融合首批变体失败 task=${taskId}: 重试 ${failedIndexes.length} 张（序号 ${failedIndexes
              .map((index) => index + 1)
              .join(',')}）`,
          );
          failures.length = 0;
          await runBatch(failedIndexes);
        }

        outcomes = results.filter((item): item is ImageOutcome => Boolean(item));
        if (outcomes.length === 0) {
          throw failures[0]?.reason ?? new Error('变体生成全部失败');
        }
        if (outcomes.length < requestedVariants) {
          this.logger.warn(
            `多图融合部分变体最终失败 task=${taskId}: 请求 ${requestedVariants} 张, 实际成功 ${outcomes.length} 张；原因: ${failures
              .map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason)))
              .join(' | ')}`,
          );
        }
      } else {
        outcomes = [
          await this.provider.generate(
            task.capability,
            inputPaths,
            { ...params, variantIndex: 1, variantTotal: 1 },
            maskPath,
          ),
        ];
      }
      const isVideo = outcomes[0]?.kind === 'video';

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

      /*
       * ── AIGC 内容标识 (B5) ────────────────────────────────────────
       *
       * 放在**终止检查点之后、落库之前**:
       *   · 之后 —— 已被后台终止的任务不该再花时间合成角标;
       *   · 落库之前 —— 未标识的产出绝不写存储, 否则用户拿到手就是一张
       *     无标识的 AI 图, 事后再删也只是删了记录、文件可能已被下载。
       *
       * 失败策略与标识办法一致:
       *   · 显式角标失败 → 任务判失败 42203 并退还积分（fail-closed）;
       *   · 隐式元数据失败 → 只告警, 图片照常交付（fail-open, 可见角标仍在）。
       *
       * 视频没有本地内嵌能力（无 ffmpeg）, 如实记录 `method='api-only'`:
       * 标识只存在于接口字段与播放器角标, 脱离本平台后不再携带。
       */
      const prepared: Array<{
        buffer: Buffer;
        format: string;
        durationMs: number | null;
        aigcMeta: AigcMeta;
        aigcLabeledAt: Date | null;
      }> = [];

      for (const outcome of outcomes) {
        let outputBuffer = outcome.buffer;
        let outputFormat = outcome.format;
        let aigcMeta: AigcMeta;
        let aigcLabeledAt: Date | null = null;

        /*
         * 当前 a6api 模型对 4K 请求可能只返回约 1.6MP 的图。若直接落库，
         * 用户选择 4K 并支付 3 倍价格却拿到 1254px，是静默降级。这里按所选
         * 档位和比例统一到目标长边，再做 AIGC 标识与落库，保证交付尺寸真实可验。
         */
        if (task.capability === 'multi_fusion' && !isVideo) {
          const normalized = await normalizeFusionOutput(
            outcome.buffer,
            outcome.format,
            params.ratio,
            params.size,
          );
          outputBuffer = normalized.buffer;
          outputFormat = normalized.format;
        }

        if (isVideo) {
          aigcMeta = {
            labeled: false,
            metadata: false,
            visible: false,
            method: 'api-only',
            warning: '视频未写入内嵌标识（本机无 ffmpeg）：标识仅存在于接口字段与播放器角标',
          };
        } else {
          try {
            /*
             * 角标样式从后台配置取（3s 缓存）。`runtime()` 内部已把读失败
             * 收敛成默认样式，这里不必再兜一层。
             */
            const visible = await this.aigcLabel.runtime();
            const labeled = await labelGeneratedImage(outputBuffer, outputFormat, {
              capability: task.capability,
              taskId,
              createdAt: new Date(),
              visible: { spec: visible.spec, badgePng: visible.badgePng },
            });
            outputBuffer = labeled.buffer;
            outputFormat = labeled.format;
            aigcMeta = labeled.meta;
            aigcLabeledAt = new Date();
            if (!aigcMeta.metadata) {
              // 不阻断交付, 但必须留下痕迹: 排障时能区分"没做" 与 "做了没写进去"
              this.logger.warn(`AIGC 隐式标识未写入 task=${taskId}: ${aigcMeta.warning ?? 'unknown'}`);
            } else if (!aigcMeta.visible) {
              // 后台关闭了可见角标: 属于合规层面的运营决策, 每张产出都留一行可回溯
              this.logger.warn(`AIGC 可见角标已关闭, 仅写入隐式标识 task=${taskId}`);
            }
          } catch (e) {
            if (e instanceof AigcVisibleLabelError) {
              this.logger.error(`AIGC 可见角标合成失败, 任务判失败 task=${taskId}: ${e.message}`);
              // 与生成失败同一条认领规则: 只有真正把 running 改写为 failed 的那次才退款
              const claimed = await this.prisma.generationTask
                .updateMany({
                  where: { id: taskId, status: 'running' },
                  data: {
                    status: 'failed',
                    errorCode: '42203',
                    aigcMeta: JSON.stringify({
                      labeled: false,
                      metadata: false,
                      visible: false,
                      method: 'unsupported',
                      warning: e.message,
                    }),
                  },
                })
                .catch(() => ({ count: 0 }));
              if (claimed.count > 0) {
                await this.refundForFailure(task.ownerId, task.creditCost, taskId, 'generation_failed');
              }
              return;
            }
            throw e;
          }
        }

        prepared.push({
          buffer: outputBuffer,
          format: outputFormat,
          durationMs: 'durationMs' in outcome ? (outcome.durationMs ?? null) : null,
          aigcMeta,
          aigcLabeledAt,
        });
      }

      /*
       * 产出来源落库: 新任务只可能是 gateway。
       *
       * 结果契约已在类型层排除 local；这里再做一次运行期校验，防止未来
       * 新增 provider 通过 any/外部 SDK 绕过类型，把本地产出静默写成成功。
       * 非法来源按生成失败处理，由统一 catch 退款，绝不让它进入素材库。
       */
      for (const outcome of outcomes) {
        if (outcome.source !== 'gateway') {
          throw new Error(`生成结果来源非法: ${String(outcome.source)}；只允许模型通道产出`);
        }
      }
      const actualProvider = 'gateway';
      if (task.provider !== actualProvider) {
        await this.prisma.generationTask.update({
          where: { id: taskId },
          data: { provider: actualProvider },
        });
      }

      const storage = this.storage.getActive();
      const generatedAssets = [];
      for (const output of prepared) {
        // 产出走存储层: 写进当前默认后端, 并记录写入时的后端与 key。
        // 扩展名与 mime 都取**标识后的**实际格式，避免 PNG/JPEG 被错误下发。
        const ext = extOfFormat(output.format);
        const key = this.storage.buildKey('generated', ext);
        const stored = await storage.put(key, output.buffer, output.format);
        const url = await storage.url(key);
        const dims = isVideo ? { width: null, height: null } : await readImageDims(output.buffer);

        const asset = await this.prisma.asset.create({
          data: {
            projectId: task.projectId,
            ownerId: task.ownerId,
            kind: 'generated',
            capability: task.capability,
            sourceUrl: url,
            width: dims.width,
            height: dims.height,
            format: output.format,
            sizeBytes: stored.sizeBytes,
            durationMs: output.durationMs,
            storageBackend: storage.backend,
            storageKey: key,
            aigcMeta: JSON.stringify(output.aigcMeta),
            aigcLabeledAt: output.aigcLabeledAt,
          },
        });
        generatedAssets.push(asset);
      }

      const primary = generatedAssets[0];
      if (!primary) throw new Error('生成结果为空');

      await this.prisma.generationTask.update({
        where: { id: taskId },
        // 任务侧同样记录标识结果: 失败路径与素材侧可能不一致, 两份现场都要留
        data: {
          status: 'succeeded',
          outputAssetId: primary.id,
          outputAssetIds: JSON.stringify(generatedAssets.map((asset) => asset.id)),
          aigcMeta: JSON.stringify(prepared[0]?.aigcMeta ?? {}),
        },
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
      /*
       * 错误码区分「没通道」与「生成异常」: 前者运营要去后台配线路,
       * 后者要找模型厂商 —— 同一个 42201 会让两类问题看起来一样。
       * 无可用模型线路时, 路由器抛 NoModelChannelError。
       */
      /*
       * 42205 = 遮罩重绘没有可用通道（协议不支持编辑端点）。
       * 与 42204（一条线路都没配）分开：这里往往是「配了线路但协议是
       * 火山/MiniMax」，处置方式是换 openai 协议线路，而不是加线路。
       */
      const errorCode =
        err instanceof MaskUnsupportedError
          ? '42205'
          : err instanceof NoModelChannelError
            ? '42204'
            : '42201';
      const claimed = await this.prisma.generationTask
        .updateMany({
          where: { id: taskId, status: 'running' },
          data: { status: 'failed', errorCode },
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
      clearInterval(heartbeat);
      // 无论成功失败都清理临时目录 —— 生成失败时堆积同样致命
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── 任务恢复 ──────────────────────────────────────────────────────

  /**
   * 启动时接管上次进程遗留的任务 (单实例部署)。
   *
   * 进程重启后内存里的执行队列全丢了, 但库里这些任务还是 `running`:
   * 不处理的话它们永远不会结束 —— 用户看到的是一直"生成中", 积分也不退。
   *
   * ⚠ 只在启动瞬间做"无条件重跑", 因为此刻**确定**没有任何执行者。
   * 运行期必须用心跳判定 (见 `recoverOrphanTasks`), 否则会把
   * 正在跑的任务再跑一遍, 白花一次模型调用。
   */
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.prisma.generationTask.findMany({
        where: { status: 'running' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      if (pending.length === 0) return;
      this.logger.warn(`启动恢复: 重新接管 ${pending.length} 个未完成任务`);
      pending.forEach((t, i) => {
        // 错峰入队: 一次性 setImmediate 全部进来会把事件循环顶住
        setTimeout(() => this.enqueue(t.id), i * 50);
      });
    } catch (e) {
      // 恢复失败不能拦住应用启动 —— 它只是补偿, 不是启动前提
      this.logger.error(`启动恢复任务失败: ${(e as Error).message}`);
    }
  }

  /**
   * 回收心跳已停的孤儿任务 (调度任务 `task-recover` 调用)。
   *
   * 判定与退款都必须以**条件更新**为准: `updateMany({ status: 'running' })`
   * 返回的 count 是唯一闸门, 只有真正把任务从 running 改写为 failed 的
   * 那次调用才退款。与失败路径、后台终止路径共用一个闸门, 重复执行安全。
   *
   * 退款按 `creditCost` **快照**: 任务创建与回收之间运营可能改过价。
   */
  async recoverOrphanTasks(opts: { staleMs?: number; limit?: number } = {}): Promise<number> {
    const staleBefore = new Date(Date.now() - (opts.staleMs ?? ORPHAN_STALE_MS));
    const orphans = await this.prisma.generationTask.findMany({
      where: {
        status: 'running',
        // 没有心跳的历史任务 (加字段之前创建的) 同样算孤儿
        OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }],
      },
      select: { id: true, ownerId: true, creditCost: true },
      take: opts.limit ?? 100,
    });
    if (orphans.length === 0) return 0;

    let recovered = 0;
    for (const t of orphans) {
      const claimed = await this.prisma.generationTask
        .updateMany({
          where: { id: t.id, status: 'running' },
          // 42202 = 执行中断 (区别于 42201 生成失败)
          data: { status: 'failed', errorCode: '42202' },
        })
        .catch(() => ({ count: 0 }));
      if (claimed.count === 0) continue;
      await this.refundForFailure(t.ownerId, t.creditCost, t.id, 'recovered');
      recovered += 1;
    }

    if (recovered > 0) {
      this.logger.warn(`孤儿任务回收: ${recovered} 个 running 任务置为 failed(42202) 并已退款`);
    }
    return recovered;
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
    reason: 'generation_failed' | 'cancelled_by_admin' | 'recovered',
  ): Promise<void> {
    if (!userId || cost <= 0) return;
    const labels = {
      cancelled_by_admin: '任务被终止自动退还',
      generation_failed: '生成失败自动退还',
      recovered: '任务中断自动退还',
    } as const;
    try {
      const refund = await this.credit.grant({
        userId,
        credits: cost,
        source: 'grant',
        taskId,
        idempotencyKey: `refund:task:${taskId}`,
        // 不传 validDays → 永久批次
        reason: labels[reason],
      });
      if (refund.idempotentHit) {
        this.logger.warn(`退款已处理过, 跳过重复流水与通知: task=${taskId}`);
        return;
      }
      this.logger.log(`已退还 ${cost} 积分: task=${taskId} user=${userId} 原因=${reason}`);

      /*
       * 站内通知 (B4)。只有**真的退成功**才通知 —— 退款失败时发一条
       * 「积分已退回」会变成假证据, 用户拿它来找客服时账上其实没有。
       */
      const task = await this.prisma.generationTask
        .findUnique({ where: { id: taskId }, select: { capability: true } })
        .catch(() => null);
      // 能力中文名从 registry 取, 不落库: 改名不该需要回填历史任务
      const capabilityName = task?.capability
        ? getCapability(task.capability)?.name ?? task.capability
        : '生成任务';
      await this.notifications.notify({
        userId,
        type: 'task_failed',
        vars: { capability: capabilityName, credits: cost, reason: labels[reason] },
        fallbackTitle: '生成失败，积分已退回',
        fallbackBody: `任务「${capabilityName}」失败，${cost} 积分已原额退回。`,
        link: '/works',
      });
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

    const outputIds = orderedOutputIds(task.outputAssetId, task.outputAssetIds);
    const outputs = outputIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: outputIds } } })
      : [];
    const outputById = new Map(outputs.map((asset) => [asset.id, asset]));
    const outputAssets = outputIds
      .map((assetId) => outputById.get(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => this.serializeOutputAsset(asset, task.ownerId));

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
      // outputAsset 保留为首项，兼容既有结果卡与历史；outputAssets 是新契约。
      outputAsset: outputAssets[0] ?? null,
      outputAssets,
    };
  }

  /** 删除作品: 连带删除其产出的生成图与磁盘文件 (作品=任务+产物) */
  async removeTask(ownerId: string, id: string) {
    const task = await this.prisma.generationTask.findUnique({ where: { id } });
    if (!task || task.ownerId !== ownerId) {
      throw new AppError(40001, '任务不存在或无权限', 403);
    }

    const outputIds = orderedOutputIds(task.outputAssetId, task.outputAssetIds);
    const outputs = outputIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: outputIds } } })
      : [];

    await this.prisma.generationTask.delete({ where: { id } });

    let removedAsset = outputs.length > 0;
    if (outputs.length > 0) {
      await this.prisma.asset
        .deleteMany({ where: { id: { in: outputs.map((asset) => asset.id) } } })
        .catch(() => undefined);
    }

    /*
     * 文件: 按**写入时的后端**删除，失败不阻塞 (库已删, 留文件无害)。
     *
     * 必须走 StorageService 而不是拼本地路径: 素材可能落在 oss/minio,
     * 那里没有 /uploads/ 前缀, 按本地路径推导只会静默漏删,
     * 对象存储账单上留下一堆已从界面消失的文件。
     */
    for (const out of outputs) {
      if (out.storageKey) {
        const backend = (out.storageBackend as StorageBackend) ?? 'local';
        await this.storage.get(backend)?.delete(out.storageKey).catch(() => undefined);
      } else if (out.sourceUrl?.startsWith('/uploads/')) {
        // 历史行没有 storageKey: 退回本地路径推导
        const parts = out.sourceUrl.replace(/^\/uploads\//, '').split('/').filter(Boolean);
        if (parts.length === 2 && !parts.some((p) => p.includes('..'))) {
          await unlink(join(resolveUploadsDir(), parts[0], parts[1])).catch(() => undefined);
        }
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
      include: { outputAsset: true },
    });
    const allOutputIds = Array.from(
      new Set(tasks.flatMap((task) => orderedOutputIds(task.outputAssetId, task.outputAssetIds))),
    );
    const outputRows = allOutputIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: allOutputIds } } })
      : [];
    const outputById = new Map(outputRows.map((asset) => [asset.id, asset]));

    return tasks.map((t) => {
      /*
       * 产出素材被后台下架 (status='hidden') 的不再下发。没有产出的任务
       * (失败 / 进行中) 照常保留 —— 它们不是「被下架」, 而是本来就没有图。
       */
      const outputAssets = orderedOutputIds(t.outputAssetId, t.outputAssetIds)
        .map((assetId) => outputById.get(assetId))
        .filter((asset): asset is NonNullable<typeof asset> => asset?.status === 'visible')
        .map((asset) => this.serializeOutputAsset(asset, t.ownerId));
      return {
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
        outputAsset: outputAssets[0] ?? null,
        outputAssets,
      };
    });
  }

  /** 把任务里的素材记录转成前端任务接口的稳定形状。 */
  private serializeOutputAsset(
    output: {
      id: string;
      sourceUrl: string;
      aigcMeta: string;
      capability: string | null;
      width: number | null;
      height: number | null;
      format: string;
      durationMs: number | null;
    },
    ownerId: string,
  ) {
    return {
      id: output.id,
      sourceUrl: output.sourceUrl,
      signedUrl: this.signedUrl.sign(output.sourceUrl, { userId: ownerId }),
      aigc: parseAigcMeta(output.aigcMeta),
      capability: output.capability,
      width: output.width,
      height: output.height,
      format: output.format,
      durationMs: output.durationMs ?? null,
      // 产出模态由 mime 推导，不能用能力当前声明的模态倒推历史文件。
      modality: output.format?.startsWith('video/') ? 'video' : 'image',
    };
  }

  /**
   * 把遮罩素材物化成本地临时文件（局部重绘，2026-10-22）。
   *
   * @returns 无遮罩时 undefined；有遮罩时返回临时 PNG 的绝对路径
   *
   * 校验与 createTask 同一套口径（本人 + `kind='original'`）。这里**再查一次**
   * 而不是把 createTask 的结论带过来：任务可能是启动恢复重跑的，
   * 中间用户可能已经删掉了那张素材。
   */
  private async materializeMask(
    maskAssetId: unknown,
    ownerId: string,
    tempDir: string,
    sourceAsset: { id: string; sourceUrl: string; storageKey: string | null; storageBackend: string; width: number | null; height: number | null },
  ): Promise<string | undefined> {
    const id = typeof maskAssetId === 'string' ? maskAssetId.trim() : '';
    if (!id) return undefined;

    const asset = await this.prisma.asset.findFirst({
      where: { id, ownerId, kind: 'original' },
      select: { id: true, sourceUrl: true, storageKey: true, storageBackend: true },
    });
    if (!asset) {
      throw new AppError(40001, '遮罩素材不存在或无权限', 400);
    }

    if (!sourceAsset) {
      throw new AppError(40001, '应用遮罩时缺少原图素材', 400);
    }
    const sourceBuf = await this.readAssetBytes(sourceAsset);
    const sourceInfo = inspectUploadedImage(sourceBuf);
    const buf = await this.readAssetBytes(asset);
    inspectMaskImage(buf, { width: sourceInfo.width, height: sourceInfo.height });

    // 遮罩画布以透明像素表示“要修改的区域”。全不透明的遮罩会让模型
    // 收到一张“没有任何可编辑像素”的图，必须在调用通道前明确失败。
    const mask = await Jimp.read(buf);
    let transparent = 0;
    const data = mask.bitmap.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) transparent += 1;
    }
    if (transparent === 0) {
      throw new AppError(40001, '遮罩没有任何透明区域，无法确定重绘范围', 400);
    }

    // 扩展名固定 png: OpenAI 的 edits 端点要求遮罩是 PNG, 与素材原格式无关
    const path = join(tempDir, `mask-${asset.id}.png`);
    await writeFile(path, buf);
    return path;
  }

  /**
   * 把局部重绘的逐标注参考图转成文字描述, 并写回 `params.__referenceHints`。
   *
   * 当前图像通道还没有参考站 createInpainting 那种「参考图资产 id」协议;
   * 在不新增厂商协议的前提下, 这里把参考图交给多模态文生文通道做客观描述,
   * 再把描述并入局部重绘提示词 —— 上传的参考图因此真正参与生成, 不再只落库不用。
   *
   * 任一参考图解析失败只降级 (跳过该图), 不让整单生成因此失败: 参考图是
   * 增强信息, 主输入仍是原图 + 遮罩 + 文字描述。
   */
  private async attachLocalRedrawReferenceHints(params: Record<string, any>, ownerId: string): Promise<void> {
    const annotations = parseLocalRedrawAnnotations(params.annotations);
    const hints: string[] = [];
    for (const item of annotations) {
      if (typeof item.referenceAssetId !== 'string' || !item.referenceAssetId.trim()) continue;
      try {
        const result = await this.promptTools.imageToPrompt(ownerId, item.referenceAssetId, item.instruction);
        const text = result.text?.trim();
        if (text) hints.push(`${item.label || '参考图'}：${text}`);
      } catch (e) {
        this.logger.warn(`局部重绘参考图 ${item.referenceAssetId} 转描述失败, 已跳过 — ${(e as Error).message}`);
      }
    }
    if (hints.length > 0) params.__referenceHints = hints;
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

/** 安全解析 aigcMeta JSON: 坏数据不该让列表接口整个 500 */
function parseAigcMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** 任务产出顺序：首项始终是兼容字段 outputAssetId，之后是扩展的变体列表。 */
function orderedOutputIds(primaryId: string | null, idsJson: string | null | undefined): string[] {
  let extra: string[] = [];
  if (idsJson) {
    try {
      const parsed = JSON.parse(idsJson);
      if (Array.isArray(parsed)) {
        extra = parsed.filter((id): id is string => typeof id === 'string' && Boolean(id));
      }
    } catch {
      // 坏数据不应让任务详情整个 500；退回单产出字段。
    }
  }
  return Array.from(new Set([primaryId, ...extra].filter((id): id is string => Boolean(id))));
}

/** 从 sourceUrl 推断扩展名, 供临时文件命名 */
function extOf(sourceUrl: string): string {
  const m = sourceUrl.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  return m ? `.${m[1]}` : '.jpg';
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** 请求体字段与 Idempotency-Key 头二选一；同时给出时必须一致。 */
function normalizeIdempotencyKey(bodyValue?: string, headerValue?: string): string | undefined {
  const body = typeof bodyValue === 'string' ? bodyValue.trim() : '';
  const header = typeof headerValue === 'string' ? headerValue.trim() : '';
  if (body && header && body !== header) {
    throw new AppError(40001, '请求体与 Idempotency-Key 头的幂等键不一致', 400);
  }
  const key = body || header;
  if (!key) return undefined;
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new AppError(40001, '幂等键必须是 8-128 位字母、数字或 . _ : -', 400);
  }
  return key;
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
  /*
   * ⚠️ 这里比较的是**完整 mime**（`image/png`），不是 `/` 前的主类型。
   * 曾经的写法只取了 `image` / `video` 主类型，于是所有分支都匹配不上、
   * 一律落到 default → 全部存成 `.jpg`：PNG 产出被按 image/jpeg 下发，
   * 更严重的是 MP4 也变成 `.jpg`，存储层按扩展名给出 image/jpeg，
   * 浏览器把视频当图片解码 → 「生成成功但视频打不开」。
   */
  const sub = format.split(';')[0].trim().toLowerCase();
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

/** 把多图融合产出统一到所选画质档位；仅处理 Jimp 可安全重编码的 PNG/JPEG。 */
async function normalizeFusionOutput(
  buffer: Buffer,
  format: string,
  ratio: unknown,
  size: unknown,
): Promise<{ buffer: Buffer; format: string }> {
  if (format !== 'image/png' && format !== 'image/jpeg') return { buffer, format };
  const target = multiFusionOutputDimensions(ratio, size);
  if (!target) return { buffer, format };
  const image = await Jimp.read(buffer);
  if (image.bitmap.width === target.width && image.bitmap.height === target.height) {
    return { buffer, format };
  }
  const sourceRatio = image.bitmap.width / image.bitmap.height;
  const targetRatio = target.width / target.height;
  if (Math.abs(sourceRatio - targetRatio) > 0.01) {
    // 模型偶发按正方形出图；直接 resize 会把主体拉扁，居中等比裁切后再对齐尺寸。
    image.cover({ w: target.width, h: target.height });
  } else {
    image.resize({ w: target.width, h: target.height });
  }
  return {
    buffer: await image.getBuffer(format === 'image/jpeg' ? JimpMime.jpeg : JimpMime.png),
    format,
  };
}
