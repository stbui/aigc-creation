import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { gatewayConfigOf } from '../providers/gateway.config';
import { ChannelRepository } from '../providers/channel-repository';
import { CAPABILITIES, getCapability } from './capability.registry';
import type { CapabilityRoute } from '../providers/gateway.types';
import type { Modality } from '../providers/modality';

/**
 * 能力的**运行时真相**（区别于 registry 里静态声明的 `mode`）。
 *
 * 为什么需要它
 * ----------
 * `mode` 是代码里的一个字符串，回答「这项能力实现到什么程度」。但用户真正
 * 关心的是「我现在按下去会发生什么」，它由三件**运行时**的事共同决定：
 *   1. 后台是否把这项能力下线了（CapabilityControl）
 *   2. 逐能力路由是 local 还是 remote，以及对应模态的云端通道是否配置
 *   3. 对应的真实模型通道是否可用
 *
 * 把这三者合成 `runtime.effective` 下发，前端就不用（也无法）靠 `mode` 猜：
 * `mode: 'real'` 的能力在没配通道时实际不可提交。混淆两者会让界面上的
 * 「已接入」变成谎话。
 *
 * 与 `task.provider` 的分工
 * -----------------------
 * 这里是**事前**的预期（按下去会怎样），`task.provider` 是**事后**的事实
 * （这一次实际走的哪条）。2026-10-25 起本地图像生成算法已删除，
 * 新任务的 provider 恒为 gateway；结果卡仍以 `task.provider` 为准。
 */

/**
 * 保留字段供旧客户端兼容。2026-10-25 起本地生成算法已删除，恒为 `none`。
 */
export type LocalQuality = 'none';

export type EffectiveRoute = 'remote' | 'disabled' | 'unavailable';

/**
 * 某模态此刻「有没有可用的云端通道」。
 *
 * label 是给用户看的一句话，带上实际会走的那条线路，便于排障时对号入座。
 */
interface RemoteInfo {
  available: boolean;
  label: string;
}

export interface CapabilityRuntime {
  /** 后台管控开关（无记录 = 启用） */
  enabled: boolean;
  /** 逐能力路由配置：auto / remote；local 仅用于识别存量已停用配置 */
  route: CapabilityRoute;
  /** 该模态此刻是否具备可用的云端通道 */
  remoteAvailable: boolean;
  /** @deprecated 本地生成已移除，恒为 none */
  localQuality: LocalQuality;
  /** 一句话结论：这一单大概率会走哪条路 */
  effective: EffectiveRoute;
  /** 给用户看的原因（下架原因 / 通道未配 / 存量 local 已停用） */
  reason: string;
}

/**
 * 管控记录的短缓存。
 *
 * 生成链路的每个任务都要查一次 —— 直接打库会把「一次生成」变成两次查询。
 * 3 秒与本项目其它运行时配置（gateway.config）保持同一个量级：后台改完最多
 * 3 秒生效，后台写入时主动失效。
 */
const CONTROL_TTL_MS = 3000;

/** 通道可用性缓存：与管控记录同量级，后台改完最多 3 秒生效 */
const REMOTE_TTL_MS = 3000;

interface ControlRow {
  capabilityId: string;
  enabled: boolean;
  reason: string | null;
}

@Injectable()
export class CapabilityAvailabilityService {
  private readonly log = new Logger(CapabilityAvailabilityService.name);
  private cache: { at: number; rows: Map<string, ControlRow> } | null = null;

  /**
   * 每个模态的通道可用性缓存。
   *
   * 为什么要单独查：`gatewayConfigOf().enabled` 只反映**旧版单通道配置**，
   * 多渠道上线后真正的调度依据是 `ModelChannel` 线路表。只看旧配置会出现
   * 「后台配好了线路、生成也确实走了云端，但界面仍标『未配置云端通道』」——
   * 用户看到的徽标与实际行为相反。
   */
  private readonly remoteCache = new Map<Modality, { at: number; info: RemoteInfo }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRepository,
  ) {}

  /**
   * 某模态当前是否有可用线路。
   *
   * `ChannelRepository.snapshot()` 同时覆盖两种来源：线路表里启用的线路，
   * 以及表为空时由旧版 `gateway.<modality>.*` 合成的通道 —— 故这里不需要
   * 再叠一层 gatewayConfig 判断，两者口径统一在同一个快照里。
   */
  private async remoteOf(modality: Modality): Promise<RemoteInfo> {
    const hit = this.remoteCache.get(modality);
    if (hit && Date.now() - hit.at < REMOTE_TTL_MS) return hit.info;

    let info: RemoteInfo = { available: false, label: '' };
    try {
      const snapshot = await this.channels.snapshot(modality);
      const usable = snapshot.channels.find(
        (c) => c.enabled && c.protocolKnown && Boolean(c.baseUrl),
      );
      if (usable) {
        info = {
          available: true,
          label: `云端通道可用（${usable.name} · ${usable.model || '默认模型'}）`,
        };
      }
    } catch (e) {
      // 读通道表失败只影响「预期徽标」，不能让 /capabilities 整个 500
      this.log.warn(`读取 ${modality} 通道快照失败, 按未配置处理 — ${(e as Error).message}`);
    }
    this.remoteCache.set(modality, { at: Date.now(), info });
    return info;
  }

  /** 清空缓存（后台写入后调用，避免「刚下线还能提交」的 3 秒空窗） */
  invalidate(): void {
    this.cache = null;
    this.remoteCache.clear();
  }

  private async controls(): Promise<Map<string, ControlRow>> {
    if (this.cache && Date.now() - this.cache.at < CONTROL_TTL_MS) return this.cache.rows;
    const rows = await this.prisma.capabilityControl.findMany();
    const map = new Map<string, ControlRow>(
      rows.map((r) => [r.capabilityId, { capabilityId: r.capabilityId, enabled: r.enabled, reason: r.reason }]),
    );
    this.cache = { at: Date.now(), rows: map };
    return map;
  }

  /** 单项能力的运行时状态 */
  async runtimeOf(capabilityId: string): Promise<CapabilityRuntime | null> {
    const def = getCapability(capabilityId);
    if (!def) return null;
    const map = await this.controls();
    const remote = await this.remoteOf(def.modality);
    return this.compose(def.id, def.modality, remote, map.get(capabilityId));
  }

  /** 全量能力的运行时状态（`GET /capabilities` 用） */
  async runtimeAll(): Promise<Record<string, CapabilityRuntime>> {
    const map = await this.controls();
    /*
     * 三个模态各取一次快照 —— 不按能力逐项去查，否则 16 项能力会变成 16 次查表。
     * 同一请求内同一模态的结论必然一致，这正是用户期望的「这一屏说的是同一件事」。
     */
    const remotes = new Map<Modality, RemoteInfo>();
    for (const modality of ['image', 'text', 'video'] as Modality[]) {
      remotes.set(modality, await this.remoteOf(modality));
    }
    const out: Record<string, CapabilityRuntime> = {};
    for (const def of CAPABILITIES) {
      const remote = remotes.get(def.modality) ?? { available: false, label: '' };
      out[def.id] = this.compose(def.id, def.modality, remote, map.get(def.id));
    }
    return out;
  }

  /**
   * 合成运行时结论。
   *
   * 先看运营下线状态，再看存量路由与通道。`route=local` 是 2026-10-25 前
   * 写入的存量配置；本地生成已删除，因此它必须报 `unavailable`，
   * 既不能静默改走远程，也不能假装仍会产出本地图片。
   */
  private compose(
    id: string,
    modality: Modality,
    remote: RemoteInfo,
    control?: ControlRow,
  ): CapabilityRuntime {
    const cfg = gatewayConfigOf(modality as 'image' | 'text' | 'video');
    const route = cfg.routeOf(id);
    const remoteAvailable = remote.available;
    const localQuality: LocalQuality = 'none';
    const enabled = control ? control.enabled : true;
    const disabledReason = control?.reason || '该能力已暂时下线';
    const needsModel = '该能力需要真实模型才能生成，当前暂不可用';

    let effective: EffectiveRoute;
    let reason: string;

    if (!enabled) {
      effective = 'disabled';
      reason = disabledReason;
    } else if (route === 'local') {
      // 存量配置：不静默改写，但明确告知不会再有本地产出
      effective = 'unavailable';
      reason = '本地生成已停用，请将该能力的路由改为 auto 或 remote，并配置可用的模型通道';
    } else {
      effective = remoteAvailable ? 'remote' : 'unavailable';
      reason = remoteAvailable
        ? route === 'remote'
          ? `${remote.label}（强制远程）`
          : remote.label
        : needsModel;
    }

    return { enabled, route, remoteAvailable, localQuality, effective, reason };
  }

  /** 后台列表：每项能力 + 管控记录 + 运行时结论（含未落行的默认值） */
  async adminList() {
    const runtime = await this.runtimeAll();
    const rows = await this.prisma.capabilityControl.findMany();
    const byId = new Map(rows.map((r) => [r.capabilityId, r]));
    return CAPABILITIES.map((c) => {
      const row = byId.get(c.id);
      return {
        capabilityId: c.id,
        name: c.name,
        group: c.group,
        modality: c.modality,
        mode: c.mode,
        enabled: row ? row.enabled : true,
        reason: row?.reason ?? null,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
        runtime: runtime[c.id],
      };
    });
  }

  /**
   * 上下线。
   *
   * 两条硬规则：
   * 1. **下架必须填原因** —— 用户在工作台看到的是一句「已下线」，没有原因
   *    就只能去问客服；原因同时进审计。
   * 2. 未知能力 id 直接拒绝（不做「先建行后校验」），否则一个拼写错误会在表里
   *    留下一条永远不生效的记录。
   */
  async setEnabled(capabilityId: string, enabled: boolean, reason: string | undefined, actor: string) {
    const def = getCapability(capabilityId);
    if (!def) {
      throw new Error(`未知能力: ${capabilityId}`);
    }
    const trimmed = (reason ?? '').trim();
    if (!enabled && !trimmed) {
      throw new Error('下架能力必须填写原因');
    }
    const row = await this.prisma.capabilityControl.upsert({
      where: { capabilityId },
      create: { capabilityId, enabled, reason: enabled ? null : trimmed, updatedBy: actor },
      update: { enabled, reason: enabled ? null : trimmed, updatedBy: actor },
    });
    this.invalidate();
    this.log.log(`能力 ${capabilityId} ${enabled ? '上线' : '下线'}（${actor}）`);
    return row;
  }
}
