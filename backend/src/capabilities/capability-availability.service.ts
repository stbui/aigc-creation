import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RouteCatalogService } from '../model/catalog/route-catalog.service';
import type { CachedLogicalModel, RouteCatalogSnapshot } from '../model/routing/routing.types';
import { RouteHealthService } from '../model/routing/route-health.service';
import { CAPABILITIES, getCapability } from './capability.registry';
import { AppError } from '../common/app.exception';

/**
 * 能力的**运行时真相**（区别于 registry 里静态声明的 `mode`）。
 *
 * 为什么需要它
 * ----------
 * `mode` 是代码里的一个字符串，回答「这项能力实现到什么程度」。但用户真正
 * 关心的是「我现在按下去会发生什么」，它由两件**运行时**的事共同决定：
 *   1. 后台是否把这项能力下线了（CapabilityControl）
 *   2. 路由目录里有没有**这项能力**的可用线路（前台模型 → revision → 线路 → 渠道模型）
 *
 * 把两者合成 `runtime.effective` 下发，前端就不用（也无法）靠 `mode` 猜：
 * `mode: 'real'` 的能力在没有任何可用线路时实际不可提交。混淆两者会让界面上
 * 的「已接入」变成谎话。
 *
 * ## 可用性口径来自路由目录
 *
 * 判断「有没有可用线路」**必须**与调度器看同一份数据：`RouteCatalogService`
 * 的快照已经在装载期剔除了停用的渠道、停用的渠道模型、没有价格档的线路。
 * 若这里另查一张表，就会出现「界面说可用、提交后 42204」——用户看到的是
 * 一个反复失败却仍显示绿灯的按钮。
 *
 * 口径是**能力 id**（`LogicalModel.capability`）而不是模态：前台模型按能力发布，
 * 一个模态下可能只有部分能力配了模型。按模态判定会把「没配模型的能力」标成可用。
 *
 * ## 与任务状态的分工
 *
 * 这里是**事前**的预期（按下去会怎样），任务状态是**事后**的事实。
 * 本地图像生成算法已于 2026-10-25 删除，失败即失败并退款，不回落任何本地产出。
 */

export type EffectiveRoute = 'remote' | 'disabled' | 'unavailable';

/**
 * 某项能力此刻「有没有可用的模型线路」。
 *
 * label 带上实际会走的模型与渠道，便于排障时对号入座。
 */
interface RemoteInfo {
  available: boolean;
  label: string;
}

export interface CapabilityRuntime {
  /** 后台管控开关（无记录 = 启用） */
  enabled: boolean;
  /** 该能力此刻是否具备可用的模型线路 */
  remoteAvailable: boolean;
  /** 一句话结论：这一单大概率会走哪条路 */
  effective: EffectiveRoute;
  /** 给用户看的原因（下架原因 / 无可用线路） */
  reason: string;
}

/**
 * 管控记录的短缓存。
 *
 * 生成链路的每个任务都要查一次 —— 直接打库会把「一次生成」变成两次查询。
 * 3 秒与本项目其它运行时配置保持同一个量级：后台改完最多 3 秒生效，
 * 后台写入时主动失效。
 */
const CONTROL_TTL_MS = 3000;

/** 可用性缓存：与管控记录同量级；路由目录自身另有 30s TTL 与版本失效 */
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

  /** 每项能力的线路可用性缓存（能力 id → 结论） */
  private readonly remoteCache = new Map<string, { at: number; info: RemoteInfo }>();

  /**
   * 快照内的「能力 id → 前台模型」索引，按快照引用懒构建。
   *
   * `runtimeAll()` 会对 17 项能力逐个调用 `remoteOf`，每次都从
   * `snapshot.ordered` 全量扫描一遍；模型数量增长后这是 17 × N 的无谓重复。
   * 按能力分桶后每项只看自己的模型，判定逻辑与逐条扫描完全一致。
   */
  private modelIndex: {
    snapshot: RouteCatalogSnapshot;
    byCapability: Map<string, CachedLogicalModel[]>;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: RouteCatalogService,
    private readonly health: RouteHealthService,
  ) {}

  /**
   * 某项能力当前是否有可用线路。
   *
   * 判定条件是「目录里有该能力的前台模型，且至少一条启用且权重 > 0 的线路」——
   * 与 `RouterService` 选路用的是同一份快照，不会出现口径分歧。
   */
  private async remoteOf(capabilityId: string): Promise<RemoteInfo> {
    const hit = this.remoteCache.get(capabilityId);
    if (hit && Date.now() - hit.at < REMOTE_TTL_MS) return hit.info;

    let info: RemoteInfo = { available: false, label: '' };
    try {
      const snapshot = await this.catalog.snapshotOrThrow();
      if (!this.modelIndex || this.modelIndex.snapshot !== snapshot) {
        const byCapability = new Map<string, CachedLogicalModel[]>();
        for (const id of snapshot.ordered) {
          const model = snapshot.models.get(id);
          if (!model) continue;
          const list = byCapability.get(model.capability) ?? [];
          list.push(model);
          byCapability.set(model.capability, list);
        }
        this.modelIndex = { snapshot, byCapability };
      }
      for (const model of this.modelIndex.byCapability.get(capabilityId) ?? []) {
        const route = model.routes.find(
          (item) =>
            item.enabled &&
            item.weight > 0 &&
            // 冷却中的线路与选路器一样不可用；否则界面会亮绿灯、提交后选路失败。
            !this.health.isBlocked({
              channelId: item.channelModel.channelId,
              channelModelId: item.channelModel.id,
              routeId: item.id,
            }),
        );
        if (!route) continue;
        info = {
          available: true,
          label: `模型线路可用（${model.name} · ${route.channelModel.displayName}）`,
        };
        break;
      }
    } catch (e) {
      // 目录读失败只影响「预期徽标」，不能让 /capabilities 整个 500
      this.log.warn(`读取路由目录失败, ${capabilityId} 按无可用线路处理 — ${(e as Error).message}`);
    }
    this.remoteCache.set(capabilityId, { at: Date.now(), info });
    return info;
  }

  /** 清空缓存（后台写入后调用，避免「刚下线还能提交」的 3 秒空窗） */
  invalidate(): void {
    this.cache = null;
    this.remoteCache.clear();
    this.modelIndex = null;
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
    const remote = await this.remoteOf(def.id);
    return this.compose(remote, map.get(capabilityId));
  }

  /** 全量能力的运行时状态（`GET /capabilities` 用） */
  async runtimeAll(): Promise<Record<string, CapabilityRuntime>> {
    const map = await this.controls();
    const out: Record<string, CapabilityRuntime> = {};
    for (const def of CAPABILITIES) {
      out[def.id] = this.compose(await this.remoteOf(def.id), map.get(def.id));
    }
    return out;
  }

  /**
   * 合成运行时结论。
   *
   * 先看运营下线状态，再看有没有可用线路。两者都不改写下发内容：
   * 下线就是 `disabled`，没有线路就是 `unavailable`，绝不静默改走别的路。
   */
  private compose(remote: RemoteInfo, control?: ControlRow): CapabilityRuntime {
    const remoteAvailable = remote.available;
    const enabled = control ? control.enabled : true;

    let effective: EffectiveRoute;
    let reason: string;

    if (!enabled) {
      effective = 'disabled';
      reason = control?.reason || '该能力已暂时下线';
    } else if (remoteAvailable) {
      effective = 'remote';
      reason = remote.label;
    } else {
      effective = 'unavailable';
      reason = '该能力需要真实模型才能生成，当前暂不可用';
    }

    return { enabled, remoteAvailable, effective, reason };
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
      throw new AppError(40001, `未知能力: ${capabilityId}`, 400);
    }
    const trimmed = (reason ?? '').trim();
    if (!enabled && !trimmed) {
      throw new AppError(40001, '下架能力必须填写原因', 400);
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
