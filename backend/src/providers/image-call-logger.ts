import { Injectable, Logger } from '@nestjs/common';
import { Jimp } from 'jimp';
import { PrismaService } from '../prisma/prisma.service';
import type { CapabilityRoute } from './gateway.types';

/**
 * 模型调用埋点 —— 每次生成写一条 ModelCallLog。
 *
 * 与 AdminAuditLog 的分工: 审计记「谁在后台做了什么」, 本表记
 * 「生成链路每次调模型的明细」, 供后台通道健康度与成本对账。
 *
 * 关键约束: **埋点失败绝不影响出图**。
 * 记录是旁路观测, 不是业务主链路 —— 若写日志抛错导致用户拿不到图,
 * 那就本末倒置了。故所有写库调用都 catch 掉, 只打 WARN。
 *
 * prompt 截断存储: 用户提示词可达 4000 字, 全量入库会让记录表迅速膨胀
 * 且查询变慢; 保留前 500 字足以定位问题, 完整内容仍以 GenerationTask.params 为准。
 */

const PROMPT_MAX = 500;
const REASON_MAX = 300;

interface BaseLogInput {
  capability: string;
  params: Record<string, any>;
  prompt: string;
  route: CapabilityRoute;
  source: 'gateway' | 'local';
  model?: string;
  durationMs: number;
  /**
   * 产出模态 (2026-10-20) —— 'image' | 'text' | 'video'。
   *
   * 必填: 调用方知道自己是哪个模态, 不该由埋点器去猜 (猜错就把
   * 文本调用记成图像, 正是本字段要消除的歧义)。
   */
  modality: string;
  /** 网关侧任务 id (仅 gateway 通道有) */
  gatewayTaskId?: string;
  fallback?: boolean;
  reason?: string | null;
}

@Injectable()
export class ImageCallLogger {
  private readonly log = new Logger(ImageCallLogger.name);

  constructor(private readonly prisma: PrismaService) {}

  async logSuccess(input: BaseLogInput & { buffer: Buffer }): Promise<void> {
    // 读产出尺寸: Jimp 解析失败不应让整条记录丢失, 故独立 try 并降级为 null
    const size = await this.measure(input.buffer);
    await this.write({
      ...input,
      success: true,
      outputBytes: input.buffer?.length ?? 0,
      width: size.width,
      height: size.height,
      errorCode: null,
    });
  }

  async logFailure(input: Omit<BaseLogInput, 'model'> & { errorCode?: string }): Promise<void> {
    await this.write({
      ...input,
      success: false,
      outputBytes: 0,
      width: null,
      height: null,
      errorCode: input.errorCode ?? '42201',
    });
  }

  private async write(row: {
    capability: string;
    prompt: string;
    route: CapabilityRoute;
    source: 'gateway' | 'local';
    model?: string;
    durationMs: number;
    gatewayTaskId?: string;
    fallback?: boolean;
    reason?: string | null;
    success: boolean;
    outputBytes: number;
    width: number | null;
    height: number | null;
    errorCode: string | null;
    /**
     * 产出模态 (2026-10-20)。
     *
     * ⚠️ 必填语义但列可空: 新写入必须给值, 历史记录读出来是 null。
     * 不设默认值 'image' —— 那会把历史文本/视频调用误标成图像,
     * 而这正是本字段要消除的歧义; null 表示"未知/历史", 是诚实的表达。
     */
    modality: string;
  }): Promise<void> {
    try {
      await this.prisma.modelCallLog.create({
        data: {
          capability: row.capability,
          // 网关任务 id 放在 taskId 位: 本表 taskId 语义是「关联的生成任务」,
          // 而 provider 层拿不到业务任务 id (它在 generate.service 才创建),
          // 故此处退而记网关侧 id, 仍可用于与网关对账。
          taskId: row.gatewayTaskId ?? null,
          route: row.route,
          source: row.source,
          fallback: Boolean(row.fallback),
          reason: row.reason ? row.reason.slice(0, REASON_MAX) : null,
          model: row.model || null,
          // 产出模态 (2026-10-20): 让后台能按模态筛调用记录。
          // ⚠️ 历史记录为 null (迁移前产生), 语义是"未知", 不是"图像"。
          modality: row.modality,
          prompt: row.prompt ? row.prompt.slice(0, PROMPT_MAX) : null,
          durationMs: Math.max(0, Math.round(row.durationMs)),
          success: row.success,
          outputBytes: row.outputBytes,
          width: row.width,
          height: row.height,
          errorCode: row.errorCode,
        },
      });
    } catch (e) {
      // 旁路观测失败只告警, 不阻断出图
      this.log.warn(`写模型调用记录失败 (已忽略) — ${(e as Error).message}`);
    }
  }

  private async measure(buffer: Buffer): Promise<{ width: number | null; height: number | null }> {
    try {
      const img = await Jimp.read(buffer);
      return { width: img.bitmap.width, height: img.bitmap.height };
    } catch {
      return { width: null, height: null };
    }
  }
}