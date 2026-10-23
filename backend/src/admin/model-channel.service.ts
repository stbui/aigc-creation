import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { ChannelRepository, type ChannelSnapshot } from '../providers/channel-repository';
import { gatewayConfigOf } from '../providers/gateway.config';
import { presetsFor, protocolSupports } from '../providers/provider-presets';
import type { Modality } from '../providers/modality';
import { ModelConfigService } from './model-config.service';
import type { ConnectionOverrides } from './model-config.service';
import type {
  CreateModelChannelDto,
  ListModelChannelModelsDto,
  MoveModelChannelDto,
  TestAllModelChannelsDto,
  TestModelChannelDraftDto,
  UpdateModelChannelDto,
} from './dto/model-channel.dto';

/**
 * 模型线路（多渠道）服务。
 *
 * 只做三件事：线路 CRUD、调度来源快照、连通性测试。
 * 真正的调度顺序/熔断由 ChannelScheduler 维护，本服务不复制那套逻辑。
 *
 * 与「全局设置」的分工：
 *   - 线路 = 每个模态可配多条，按 priority 依次尝试；
 *   - 全局设置 = 旧版单通道参数 + 超时/轮询 + 素材地址。
 *     一旦某模态有线路，旧的 baseUrl/token/model/provider 不再参与调度，
 *     但超时/轮询仍按模态生效（见 ChannelScheduler 与各 provider）。
 */

const MODALITY_LABEL: Record<Modality, string> = {
  image: '文生图',
  text: '文生文',
  video: '文生视频',
};

export interface ChannelTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  detail?: string;
  testedAt: string;
  target: 'draft' | 'saved';
  usedStoredToken: boolean;
}

@Injectable()
export class ModelChannelService {
  constructor(
    private readonly repo: ChannelRepository,
    private readonly config: ModelConfigService,
  ) {}

  /** 三模态快照（供页面首屏一次拉全） */
  async listAll(): Promise<{ modalities: Record<Modality, ChannelSnapshot> }> {
    const [image, text, video] = await Promise.all([
      this.repo.snapshot('image'),
      this.repo.snapshot('text'),
      this.repo.snapshot('video'),
    ]);
    return { modalities: { image, text, video } };
  }

  async create(dto: CreateModelChannelDto) {
    this.assertProtocol(dto.modality, dto.protocol);
    const enabled = dto.enabled ?? true;
    this.assertEnabledBaseUrl(enabled, dto.baseUrl);

    /*
     * 首次新增时先把旧版单通道配置固化成第一条线路。
     * 固化与创建在仓库层同一事务里完成，materialized 如实回给前端：
     * 运营必须知道「我这次新增顺带改变了旧配置的归属」。
     */
    const { channel, materialized } = await this.repo.createWithMaterialize(dto.modality, {
      name: dto.name,
      protocol: dto.protocol,
      baseUrl: dto.baseUrl,
      token: dto.token,
      model: dto.model,
      enabled,
    });
    return { channel, materialized };
  }

  async update(id: string, dto: UpdateModelChannelDto) {
    const raw = await this.repo.getRaw(id);
    if (!raw) throw new AppError(40400, '线路不存在', 404);
    if (dto.expectedUpdatedAt && raw.updatedAt.toISOString() !== dto.expectedUpdatedAt) {
      throw new AppError(40901, '该线路已被他人修改，请刷新后重试', 409);
    }
    if (dto.clearToken && dto.token) {
      throw new AppError(40001, '不能同时修改令牌与清除令牌', 400);
    }

    const modality = raw.modality as Modality;
    if (dto.protocol !== undefined) this.assertProtocol(modality, dto.protocol);
    const enabled = dto.enabled ?? raw.enabled;
    const baseUrl = dto.baseUrl !== undefined ? dto.baseUrl : raw.baseUrl;
    this.assertEnabledBaseUrl(enabled, baseUrl);

    const channel = await this.repo.update(id, {
      name: dto.name,
      protocol: dto.protocol,
      baseUrl: dto.baseUrl,
      token: dto.token,
      clearToken: dto.clearToken,
      model: dto.model,
      enabled: dto.enabled,
    });
    return { channel };
  }

  async remove(id: string) {
    const raw = await this.repo.getRaw(id);
    if (!raw) throw new AppError(40400, '线路不存在', 404);
    const modality = raw.modality as Modality;
    await this.repo.remove(id);

    const snapshot = await this.repo.snapshot(modality);
    const remaining = snapshot.channels.filter((c) => !c.synthetic).length;
    return { deleted: true, remaining, sourceAfter: snapshot.source };
  }

  async move(id: string, dto: MoveModelChannelDto) {
    try {
      const channels = await this.repo.move(id, dto.dir);
      return { channels };
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      if (message === '通道不存在') throw new AppError(40400, message, 404);
      throw new AppError(40001, message, 400);
    }
  }

  async materialize(modality: Modality) {
    const materialized = await this.repo.materialize(modality);
    return { materialized, channels: await this.repo.list(modality) };
  }

  /** 测试已保存线路 —— 不更新健康状态（探测成功不等于真实生成成功） */
  async testSaved(id: string): Promise<ChannelTestResult> {
    const raw = await this.repo.getRaw(id);
    if (!raw) throw new AppError(40400, '线路不存在', 404);
    const result = await this.config.testConnection(raw.modality as Modality, {
      protocol: raw.protocol,
      baseUrl: raw.baseUrl,
      token: raw.token,
      model: raw.model,
      // 显式测试不因「已停用」而拒绝——停用只影响调度，不影响排障
      enabled: true,
    });
    return {
      ...result,
      target: 'saved',
      usedStoredToken: Boolean(raw.token),
    };
  }

  /** 测试草稿 —— 未保存的表单值也能验证 */
  async testDraft(dto: TestModelChannelDraftDto): Promise<ChannelTestResult> {
    const raw = dto.id ? await this.repo.getRaw(dto.id) : null;
    if (dto.id && !raw) throw new AppError(40400, '线路不存在', 404);
    if (raw && raw.modality !== dto.modality) {
      throw new AppError(40001, '线路所属模态与测试模态不一致', 400);
    }

    const base = gatewayConfigOf(dto.modality);
    const token = dto.token !== undefined ? dto.token : (raw?.token ?? '');
    const usedStoredToken = dto.token === undefined && Boolean(raw?.token);

    const overrides: ConnectionOverrides = {
      protocol: dto.protocol ?? raw?.protocol ?? base.provider,
      baseUrl: dto.baseUrl ?? raw?.baseUrl ?? base.baseUrl,
      token,
      model: dto.model ?? raw?.model ?? base.model,
      // 草稿测试的目的是「这份配置行不行」，不因尚未启用而拒绝探测
      enabled: dto.enabled ?? true,
    };
    this.assertProtocol(dto.modality, overrides.protocol!);

    const result = await this.config.testConnection(dto.modality, overrides);
    return { ...result, target: 'draft', usedStoredToken };
  }

  /**
   * 拉取厂商模型清单 —— 让「默认模型」从手填变成可选。
   *
   * 返回两条来源, 页面合并展示:
   *   preset  代码内置的厂商预设（带中文说明, 离线可用, 但不一定最新）
   *   remote  用该线路令牌向厂商模型列表接口实时拉取（null = 拉不到）
   *
   * ⚠️ 令牌语义与草稿测试一致: 未传 = 复用已保存线路的令牌;
   * 只在本请求内使用, 不落库、不进审计。
   */
  async listModels(dto: ListModelChannelModelsDto): Promise<{
    modality: Modality;
    protocol: string;
    baseUrl: string;
    usedStoredToken: boolean;
    preset: Array<{ id: string; label: string; note?: string }>;
    remote: string[] | null;
    endpoints: string[];
    message: string;
  }> {
    const raw = dto.id ? await this.repo.getRaw(dto.id) : null;
    if (dto.id && !raw) throw new AppError(40400, '线路不存在', 404);
    if (raw && raw.modality !== dto.modality) {
      throw new AppError(40001, '线路所属模态与查询模态不一致', 400);
    }

    const base = gatewayConfigOf(dto.modality);
    const token = dto.token !== undefined ? dto.token : (raw?.token ?? '');
    const usedStoredToken = dto.token === undefined && Boolean(raw?.token);
    const protocol = (dto.protocol ?? raw?.protocol ?? base.provider).trim().toLowerCase();
    const baseUrl = (dto.baseUrl ?? raw?.baseUrl ?? base.baseUrl).replace(/\/+$/, '');

    const preset =
      presetsFor(dto.modality).find(
        (p) => p.protocol === protocol && p.baseUrl.replace(/\/+$/, '') === baseUrl,
      )?.models ?? [];

    const result = await this.config.listModels(dto.modality, {
      protocol,
      baseUrl,
      token,
      enabled: true,
    });

    return {
      modality: dto.modality,
      protocol,
      baseUrl,
      usedStoredToken,
      preset,
      remote: result.ids,
      endpoints: result.endpoints,
      message: result.message,
    };
  }

  /**
   * 批量测试全部线路。
   *
   * 并发上限 4：探测本身有 15s 上限，串行会让「全部测试」在最坏情况下等太久；
   * 但不加限制会一次性打爆上游（尤其同一厂商的多条线路）。
   */
  async testAll(dto: TestAllModelChannelsDto = {}) {
    const startedAt = Date.now();
    const modalities: Modality[] = dto.modality
      ? [dto.modality]
      : ['image', 'text', 'video'];
    const targets = await this.collectTestTargets(modalities);

    const results = await mapWithConcurrency(targets, 4, async (t) => {
      try {
        const r = await this.config.testConnection(t.modality, {
          protocol: t.protocol,
          baseUrl: t.baseUrl,
          token: t.token,
          model: t.model,
          enabled: true,
        });
        return {
          channelId: t.id,
          modality: t.modality,
          name: t.name,
          enabled: t.enabled,
          synthetic: t.synthetic,
          ...r,
          target: 'saved' as const,
          usedStoredToken: Boolean(t.token),
        };
      } catch (e) {
        return {
          channelId: t.id,
          modality: t.modality,
          name: t.name,
          enabled: t.enabled,
          synthetic: t.synthetic,
          ok: false,
          latencyMs: 0,
          message: '测试过程异常',
          detail: (e as Error).message ?? String(e),
          testedAt: new Date().toISOString(),
          target: 'saved' as const,
          usedStoredToken: Boolean(t.token),
        };
      }
    });

    return {
      results,
      okCount: results.filter((r) => r.ok).length,
      total: results.length,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /** 把每个模态的线路（含合成线路）摊平成测试目标；未接入的模态给一条占位失败 */
  private async collectTestTargets(modalities: Modality[]) {
    const out: Array<{
      id: string | null;
      modality: Modality;
      name: string;
      protocol: string;
      baseUrl: string;
      token: string;
      model: string;
      enabled: boolean;
      synthetic: boolean;
    }> = [];

    for (const modality of modalities) {
      const snapshot = await this.repo.snapshot(modality);
      if (snapshot.channels.length === 0) {
        out.push({
          id: null,
          modality,
          name: `${MODALITY_LABEL[modality]}（未配置）`,
          protocol: '',
          baseUrl: '',
          token: '',
          model: '',
          enabled: false,
          synthetic: false,
        });
        continue;
      }
      for (const ch of snapshot.channels) {
        if (ch.synthetic) {
          const cfg = gatewayConfigOf(modality);
          out.push({
            id: ch.id,
            modality,
            name: ch.name,
            protocol: cfg.provider,
            baseUrl: cfg.baseUrl,
            token: cfg.token,
            model: cfg.model,
            enabled: true,
            synthetic: true,
          });
        } else {
          const raw = await this.repo.getRaw(ch.id);
          if (!raw) continue;
          out.push({
            id: ch.id,
            modality,
            name: ch.name,
            protocol: raw.protocol,
            baseUrl: raw.baseUrl,
            token: raw.token,
            model: raw.model,
            enabled: raw.enabled,
            synthetic: false,
          });
        }
      }
    }
    return out;
  }

  private assertProtocol(modality: Modality, protocol: string): void {
    if (!protocolSupports(modality, protocol)) {
      throw new AppError(
        40001,
        `协议 "${protocol}" 在${MODALITY_LABEL[modality]}下尚未实现，保存后生成会直接失败`,
        400,
      );
    }
  }

  private assertEnabledBaseUrl(enabled: boolean, baseUrl?: string): void {
    if (!enabled) return;
    if (!baseUrl || !baseUrl.trim()) {
      throw new AppError(40001, '启用线路时必须填写接入地址', 400);
    }
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new AppError(40001, '接入地址必须是合法的 URL', 400);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AppError(40001, '接入地址只支持 http / https', 400);
    }
  }
}

/** 简单并发池：不引入依赖，保证最多 limit 个任务同时执行 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}
