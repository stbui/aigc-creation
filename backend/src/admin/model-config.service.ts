import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import {
  ChannelRepository,
  type ChannelSnapshot,
} from '../providers/channel-repository';
import {
  CONFIG_DEFS,
  CONFIG_GROUPS,
  findConfigDef,
  ROUTE_VALUES,
  type ConfigDef,
} from '../providers/channel-config.defs';
import {
  gatewayConfig,
  gatewayConfigOf,
  invalidateGatewayConfigCache,
  setGatewayConfigOverrides,
} from '../providers/gateway.config';
import { CAPABILITIES } from '../capabilities/capability.registry';
import {
  allowsLocalFallback,
  type CapabilityPlugin,
} from '../capabilities/capability-plugin.type';
import {
  MODALITIES,
  PROTOCOL_OPTIONS_BY_MODALITY,
  protocolSpec,
  protocolSupports,
  videoProtocolSpec,
  presetsFor,
  findPreset,
  VENDOR_PRESETS,
  findVendor,
  baseUrlOf,
  specOf,
  type Modality,
} from '../providers/provider-presets';
import { baseUrlIssue, normalizeBaseUrl } from '../providers/base-url';
import { CapabilityRouterProvider } from '../providers/capability-router.provider';

/** 连通性测试的草稿覆盖值 —— 不落库，仅本次探测使用 */
export interface ConnectionOverrides {
  protocol?: string;
  baseUrl?: string;
  token?: string;
  model?: string;
  enabled?: boolean;
}

/**
 * 模型通道配置 (后台「模型配置」页)。
 *
 * 与 AdminSettingsService 同构的「代码默认值 → DB 覆盖 → env」三层模型,
 * env 优先级最高 (见 channel-config.defs.ts 顶部说明)。
 *
 * ── 按模态组织 (2026-10-20) ──────────────────────────────────────────
 * 返回结构新增 `channels: { image, text, video }`, 每个模态有**独立的**
 * 基址/令牌/模型/协议与各自的连通性测试。原 `channel` 字段保留且**恒等于
 * channels.image** —— 它是 2026-10-20 之前唯一的通道视图, 保留可让存量前端
 * 与外部脚本继续工作, 不必同步改。
 *
 * 凭据处理 (每个模态的 token) —— 本类唯一需要特别小心的部分:
 *   读取: 永不返回明文, 只给 hasValue + 脱敏尾巴
 *   写入: 空字符串 = 保持原值 (不是清空), 需显式 clear
 *   为什么: 明文经 HTTP 响应外泄是凭据事故的最短路径, 而运营看得到明文也没有用 ——
 *   真要换 token 应该直接改部署环境。
 */
@Injectable()
export class ModelConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: CapabilityRouterProvider,
    /*
     * 可选注入：既有验证脚本直接用两个参数 new ModelConfigService(...)，
     * 没有该依赖时回落到「只看全局配置」的旧算法，脚本不必跟着改。
     */
    @Optional() private readonly channelRepo?: ChannelRepository,
  ) {}

  /**
   * 读取全部分组配置。
   *
   * 每项返回生效值 + **实际来源** (env/db/default), 让运营看清「我改的值到底生效没有」——
   * 若被 env 覆盖却不知道, 会一直重复改 DB 却不见效果, 这是最容易踩的坑。
   */
  async readAll() {
    const rows = await this.prisma.modelChannelConfig.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const imageCfg = gatewayConfig();
    const sources = imageCfg.sourcesOf();
    const snapshots = await this.loadSnapshots();

    const groups = CONFIG_GROUPS.map((g) => {
      // ⚠️ 必须过滤 hidden: 存量键与新键在界面上语义重叠, 同时展示会让运营
      // 不知道该改哪个 —— 而它们只该作为回落读取源, 不该被写入。
      const defs = CONFIG_DEFS.filter((d) => d.group === g.key && !d.hidden);
      return {
        key: g.key,
        label: g.label,
        desc: g.desc,
        items: defs.map((def) => this.renderItem(def, byKey.get(def.key), sources)),
      };
    });

    return {
      groups,
      // 逐模态通道快照: 基址脱敏、协议是否已实现、各自的厂商与协议下拉
      channels: this.readChannels(byKey, snapshots),
      modalities: MODALITIES,
      // ⚠️ 兼容字段: 恒等于 channels.image, 不是「默认模态」。
      // 保留它是因为存量前端与外部脚本按 channel.* 读取; 删掉会让它们静默拿到 undefined。
      channel: {
        enabled: imageCfg.enabled,
        baseUrl: imageCfg.baseUrl ? maskUrl(imageCfg.baseUrl) : '',
        model: imageCfg.model,
        provider: imageCfg.provider,
        protocolKnown: protocolSupports('image', imageCfg.provider),
        timeoutMs: imageCfg.timeoutMs,
        pollMs: imageCfg.pollMs,
        maxPolls: imageCfg.maxPolls,
        assetBase: imageCfg.assetBase,
        effective: this.effectiveOf('image', snapshots),
      },
      /** @deprecated 用 channels.image; 保留仅为兼容 */
      vendors: presetsFor('image'),
      /** @deprecated 用 protocolOptionsByModality; 保留仅为兼容 */
      protocolOptions: PROTOCOL_OPTIONS_BY_MODALITY.image,
      routes: CAPABILITIES.map((c) => {
        /*
         * 路由配置按**能力**取, 不按模态 (2026-10-20 复核)。
         *
         * ⚠️ 这里原是 `imageCfg.routeOf(c.id)` (一律用图像通道), 重设计时
         * 一度被当成缺陷改成 `gatewayConfigOf(c.modality)`。**复核后确认那是误判**:
         * 路由键是 `gateway.route.<能力 id>` (见 channel-config.defs 的 routeDefs),
         * **不含模态前缀** —— 因为能力 id 全局唯一, 一项能力只产一种模态,
         * 按模态分三份配置本就多余。
         *
         * 三个通道的 routeOf 读的是**同一个键**, 故两种写法读出的值完全相同,
         * 行为上无差别。改成按模态读只是让代码**看起来**更严谨, 实际没修任何东西 ——
         * 属于「改了个寂寞」, 比不改更糟: 下次会有人以为这里曾有坑而反复研究。
         *
         * 保留按模态读, 但理由改为「语义正确」而非「修 bug」: 它读的是这项能力
         * **自己所属模态**的通道快照, 与下面 effective 的判定口径一致
         * (两处同源, 不会一个按模态一个不按)。
         */
        const cfgOfModality = gatewayConfigOf(c.modality);
        const route = cfgOfModality.routeOf(c.id);
        return {
          capability: c.id,
          name: c.name,
          mode: c.mode,
          modality: c.modality,
          route,
          /*
           * ⚠️ effective 必须区分「本地兜底」与「无兜底」(2026-10-20 修)。
           *
           * 改造前只有 gateway/local 两态, 未配网关一律记 local。
           * 但**视频与文本没有本地算法** —— 把它们标成「本地算法」等于
           * 在后台谎报「会回落本地出图」, 而实际上会**直接失败**。
           * 那是本项目最忌讳的那类静默不实 (与「不把本地伪装成模型」同源,
           * 反过来同样错误: 不该把「无兜底」伪装成「有本地兜底」)。
           *
           * 故三态: gateway=真实模型 / local=本地算法 / none=无兜底(会失败)。
           *
           * 2026-10-22 补充: 图像里也有**无兜底**的能力 —— 本地根本没有实现
           * (创意生图 / 局部重绘 / 图片翻译 / 自由创作, 见 allowsLocalFallback)。
           * 它们没通道时会判 failed/42204, 这里若照旧报 local, 就与 C 端 runtime 打架。
           * 判定与路由器共用 allowsLocalFallback(), 不在本文件另写一份。
           */
          effective: this.routeEffectiveOf(c, route, snapshots),
          /*
           * 该能力「能不能被压到本地」—— 供前端把 local 这个选项置灰。
           *
           * 不能靠 `effective` 反推: route=auto 且通道已配时 effective 是
           * gateway, 看不出本地是否可用。判定与路由器共用 allowsLocalFallback(),
           * 与上面的 routeEffectiveOf 同源。
           */
          localAvailable: Boolean(c.localImpl) && allowsLocalFallback(c),
        };
      }),
    };
  }

  /** 各模态的通道快照 (基址脱敏、协议是否已实现、各自的厂商与协议下拉) */
  /**
   * 各模态的通道快照 (基址脱敏、协议是否已实现、各自的厂商与协议下拉)。
   *
   * @param byKey 已加载的 ModelChannelConfig 行, 用于读出「当前选了哪个厂商」
   *              —— ModalityConfig 只描述「怎么调」不含厂商选择态 (2026-10-20)
   */
  private readChannels(
    byKey: Map<string, { value: string }>,
    snapshots: Partial<Record<Modality, ChannelSnapshot | null>>,
  ) {
    const out: Record<string, unknown> = {};
    for (const m of MODALITIES) {
      const modality = m.value;
      const cfg = gatewayConfigOf(modality);
      const snap = snapshots[modality] ?? null;
      out[modality] = {
        modality,
        label: m.label,
        desc: m.desc,
        enabled: cfg.enabled,
        baseUrl: cfg.baseUrl ? maskUrl(cfg.baseUrl) : '',
        model: cfg.model,
        provider: cfg.provider,
        /*
         * 当前选中的厂商 (2026-10-20 通道总览卡片用)。
         *
         * ⚠️ 从**配置项**读而非从 ModalityConfig 取 —— 后者没有 vendor 字段
         * (它只描述「怎么调」: 基址/令牌/模型/协议/超时, 不描述「选了哪家」)。
         * 往 ModalityConfig 加 vendor 会让它同时承担「连接参数」与「UI 选择态」
         * 两种职责, 而后者本就该由配置项承载。
         */
        vendor: byKey.get(`gateway.${modality}.vendor`)?.value ?? '',
        vendorLabel: findPreset(byKey.get(`gateway.${modality}.vendor`)?.value ?? '')?.label ?? '',
        protocolKnown: protocolSupports(modality, cfg.provider),
        timeoutMs: cfg.timeoutMs,
        pollMs: cfg.pollMs,
        maxPolls: cfg.maxPolls,
        assetBase: cfg.assetBase,
        /*
         * ⚠️ 三态而非两态 (2026-10-20 修)。
         *
         * 改造前未配网关一律记 local, 但视频/文本**没有本地兜底** ——
         * 标成 local 会在后台显示「本地算法」, 而实际调用会直接失败。
         * 那等于谎报可用性, 与「不把本地伪装成模型」是同一类错误的反向版本。
         */
        effective: this.effectiveOf(modality, snapshots),
        /*
         * 调度来源 —— 页面必须如实告诉运营「现在到底按什么在调度」：
         *   channels = 线路表 / legacy = 旧版单通道配置 / none = 未接入
         * 没有 repository（验证脚本）时按全局配置推断。
         */
        dispatchSource: snap?.source ?? (cfg.enabled ? 'legacy' : 'none'),
        channelCount: snap?.total ?? (cfg.enabled ? 1 : 0),
        availableCount: snap?.availableCount ?? (cfg.enabled ? 1 : 0),
        coolingCount: snap?.coolingCount ?? 0,
        unsupportedCount: snap?.unsupportedCount ?? 0,
        // 该模态可选项
        vendors: presetsFor(modality),
        protocolOptions: PROTOCOL_OPTIONS_BY_MODALITY[modality],
        // 配了却因协议未实现而必然失败的尴尬态, 前端据此显式警告而非静默
        configuredButUnsupported: cfg.enabled && !protocolSupports(modality, cfg.provider),
      };
    }
    return out;
  }

  /** 三模态调度快照；没有 ChannelRepository（脚本直连服务）时返回空表 */
  private async loadSnapshots(): Promise<Partial<Record<Modality, ChannelSnapshot | null>>> {
    const out: Partial<Record<Modality, ChannelSnapshot | null>> = {};
    if (!this.channelRepo) return out;
    await Promise.all(
      MODALITIES.map(async (m) => {
        out[m.value] = await this.channelRepo!.snapshot(m.value);
      }),
    );
    return out;
  }

  /**
   * 单项能力的生效来源 (后台「逐能力路由」用)。
   *
   * 与 `effectiveOf` 只差在**无本地实现的能力**: 模态级快照只能说
   * 「图像通道没配 → 本地」, 但这类能力此时不会回落, 而是判 failed/42204。
   * 后台若照旧显示 local, 就是「界面预告有图、点下去失败」——
   * 与 C 端 runtime 打架。判定与路由器共用 allowsLocalFallback()。
   */
  private routeEffectiveOf(
    def: CapabilityPlugin,
    route: string,
    snapshots: Partial<Record<Modality, ChannelSnapshot | null>>,
  ): 'gateway' | 'local' | 'none' {
    const allowLocal = Boolean(def.localImpl) && allowsLocalFallback(def);
    if (route === 'local') return allowLocal ? 'local' : 'none';
    const effective = this.effectiveOf(def.modality, snapshots);
    // 通道没配时 effectiveOf 对图像一律报 local —— 无兜底的能力要降级为 none
    return effective === 'local' && !allowLocal ? 'none' : effective;
  }

  /**
   * 该模态当前的实际生效来源。
   *
   * 「有可用线路」才算 gateway —— 只看全局 `cfg.enabled` 会在多渠道下说谎：
   * 表里有线路但旧基址为空时，旧算法会误报 local/none。
   */
  private effectiveOf(
    modality: Modality,
    snapshots: Partial<Record<Modality, ChannelSnapshot | null>>,
  ): 'gateway' | 'local' | 'none' {
    const snap = snapshots[modality];
    const available = snap ? snap.availableCount > 0 : gatewayConfigOf(modality).enabled;
    if (available) return 'gateway';
    return modality === 'image' ? 'local' : 'none';
  }

  /**
   * 厂商联动填充方案 (2026-10-20 厂商聚合后新增)。
   *
   * ## 为什么需要它
   *
   * 厂商聚合后, 同一家的多个模态**共享基址与凭据** (如硅基流动的图与文
   * 都是 api.siliconflow.cn)。但配置项仍按模态分开 (这是刻意的: 见
   * channel-config.defs 的 legacyKey 说明 —— 存量键不改名), 于是运营会看到
   * 三个模态各自一份基址输入框, 得手动填三遍同一个值。
   *
   * 故: 后端给出「选这家厂商 → 各模态该填什么」的方案, 前端一次填完。
   * 凭据(token)**仍按模态分开** —— 用户可能给图和文用不同的 key,
   * 强行合并会覆盖掉这种合法配置。
   */
  vendorFillPlan(vendorKey: string): {
    vendorKey: string;
    label: string;
    /** 各模态的填充项 (只有该厂商支持的模态才有) */
    fills: Array<{
      modality: string;
      baseUrl: string;
      provider: string;
      model: string;
      vendorPresetKey: string;
    }>;
    /** 该厂商涉及的模态 (前端据此决定要不要清掉其它模态的厂商选择) */
    modalities: string[];
  } {
    const vendor = findVendor(vendorKey);
    if (!vendor) {
      throw new AppError(40001, `未知厂商: ${vendorKey}`, 400);
    }
    const fills = vendor.channels.map((ch) => {
      const spec = specOf(ch);
      const preset = VENDOR_PRESETS.find(
        (p) => p.vendorKey === vendor.key && p.modality === ch.modality,
      );
      return {
        modality: ch.modality,
        baseUrl: baseUrlOf(vendor, ch),
        provider: ch.protocol,
        model: ch.defaultModel ?? ch.models[0]?.id ?? spec?.defaultModel ?? '',
        vendorPresetKey: preset?.key ?? '',
      };
    });
    return {
      vendorKey: vendor.key,
      label: vendor.label,
      fills,
      modalities: vendor.channels.map((c) => c.modality),
    };
  }

  /** 单个配置项 → 展示形状 (脱敏与来源标注都在这里统一收口) */
  private renderItem(
    def: ConfigDef,
    row: { value: string; overridden: boolean; updatedAt?: Date | null; updatedBy?: string | null } | undefined,
    sources: Record<string, string>,
  ) {
    const source = sources[def.key] ?? 'default';
    const base = {
      key: def.key,
      label: def.label,
      description: def.description,
      type: def.type,
      group: def.group,
      modality: def.modality ?? null,
      envName: def.envName ?? null,
      /** 存量键名; 非空说明该项由旧单前缀键回落而来, 前端可提示「读的是存量配置」 */
      legacyKey: def.legacyKey ?? null,
      secret: Boolean(def.secret),
      default: def.default,
      source,
      overridden: row?.overridden ?? false,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
    if (def.secret) {
      // 凭据: 只给「是否已配置」与脱敏尾巴, value 恒为 null
      const raw = row?.value ?? '';
      return {
        ...base,
        value: null,
        hasValue: Boolean(raw) || Boolean(process.env[def.envName ?? '']),
        masked: raw ? mask(raw) : null,
        // env 覆盖时仍让运营看到「后台曾保存过什么」—— 只给脱敏尾巴
        dbHasValue: Boolean(raw),
        dbMasked: raw ? mask(raw) : null,
        dbValue: null,
      };
    }
    return {
      ...base,
      value: effective(def, source, row?.value),
      hasValue: true,
      masked: null,
      // 仅当后台显式改过（overridden）才展示，避免把代码默认值当成「保存过的值」
      dbValue: row?.overridden ? effective(def, 'db', row.value) : null,
      dbHasValue: null,
      dbMasked: null,
    };
  }

  /**
   * 批量写入配置。
   *
   * 先全量校验再落库: 部分成功会让运营误以为整批生效。
   * 未知键直接拒绝 —— 否则运营可以写进代码里根本不认识的键, 静默失效。
   */
  async updateAll(
    settings: Record<string, unknown>,
    clears: string[] = [],
    actor?: string,
    reason?: string,
  ): Promise<{ updated: string[]; cleared: string[]; reason?: string }> {
    const entries = Object.entries(settings ?? {});
    const clearSet = new Set(clears ?? []);
    if (entries.length === 0 && clearSet.size === 0) {
      throw new AppError(40001, '没有需要更新的配置项', 400);
    }

    const normalized = entries.map(([key, raw]) => {
      const def = findConfigDef(key);
      if (!def) throw new AppError(40001, `未知配置项: ${key}`, 400);
      if (clearSet.has(key)) {
        throw new AppError(40001, `${def.label} 不能同时设置与清除`, 400);
      }
      /*
       * 存量键不可写: 它们只作为回落读取源。
       *
       * 放行写入会让界面外的调用者把值存到旧键上, 而新键一旦有任何取值
       * (哪怕是误填的空串以外的默认值) 就会盖掉它 —— 表现为「保存成功但不生效」。
       */
      if (def.hidden) {
        throw new AppError(40001, `${def.label} 是存量兼容键，不能直接写入（请改用对应模态的新键）`, 400);
      }
      // 凭据留空 = 保持原值 (不是清空), 必须显式 clear
      if (def.secret && (raw === undefined || String(raw) === '')) return null;
      return { key, value: validate(def, raw) };
    });

    const toWrite = normalized.filter((n): n is { key: string; value: string } => n !== null);
    const toClear = CONFIG_DEFS.filter((d) => clearSet.has(d.key)).map((d) => d.key);
    // 未知清除键也要拦, 否则前端传错 key 会静默无操作
    for (const key of clearSet) {
      if (!findConfigDef(key)) throw new AppError(40001, `未知配置项: ${key}`, 400);
    }

    for (const { key, value } of toWrite) {
      const existing = await this.prisma.modelChannelConfig.findUnique({ where: { key } });
      if (existing) {
        await this.prisma.modelChannelConfig.update({
          where: { key },
          data: { value: String(value), hasValue: String(value) !== '', overridden: true, updatedBy: actor ?? 'admin' },
        });
      } else {
        await this.prisma.modelChannelConfig.create({
          data: { key, value: String(value), hasValue: String(value) !== '', overridden: true, updatedBy: actor ?? 'admin' },
        });
      }
    }

    // 清除 = 把值清空并置 overridden=false, 让它回到代码默认值
    for (const key of toClear) {
      const def = findConfigDef(key)!;
      await this.prisma.modelChannelConfig.upsert({
        where: { key },
        create: { key, value: String(def.default), hasValue: false, overridden: false, updatedBy: actor ?? 'admin' },
        update: { value: String(def.default), hasValue: false, overridden: false, updatedBy: actor ?? 'admin' },
      });
    }

    // 让运行时立刻反映新配置 (不等 3s 缓存自然过期)
    await this.reloadRuntime();

    return {
      updated: toWrite.map((n) => n.key),
      cleared: toClear,
      reason,
    };
  }

  /**
   * 重载运行时配置。
   *
   * 不能只清缓存 —— 缓存里存的是解析后的快照, 下次读取仍走 resolveGatewayConfig,
   * 但那份快照的 DB 覆盖表是模块级的, 故必须重新拉库并注入。
   */
  private async reloadRuntime(): Promise<void> {
    const rows = await this.prisma.modelChannelConfig.findMany({
      where: { overridden: true },
      select: { key: true, value: true },
    });
    setGatewayConfigOverrides(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    invalidateGatewayConfigCache();
    this.router.invalidate();
  }

  /**
   * 连通性测试: 用当前生效配置发一次最小请求。
   *
   * 目的是让运营**看到真实报错**而不是猜 —— 网关不通时静默回落本地,
   * 界面上看不出是配置错了还是网关挂了。
   *
   * 按模态分流 (2026-10-20): 三种模态的探测端点完全不同
   * (图 → 协议层声明的图像端点; 文 → /v1/chat/completions; 视频 → 尚无契约),
   * 用错端点探测会得到「网络可达但方法不被接受」这种无法区分真伪的结论。
   */
  async testConnection(
    modality: Modality = 'image',
    overrides?: ConnectionOverrides,
  ): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    detail?: string;
    testedAt: string;
    target: 'draft' | 'saved';
  }> {
    const base = gatewayConfigOf(modality);
    const token = overrides?.token !== undefined ? overrides.token : base.token;
    const baseUrl = normalizeBaseUrl(overrides?.baseUrl ?? base.baseUrl);
    const cfg = {
      /*
       * 有 overrides 时按「当前草稿」判定是否可测：只要填了基址或令牌就尝试，
       * 不要求先保存（这正是本次改版要解决的体验问题）。
       */
      enabled: overrides
        ? (overrides.enabled ?? Boolean(baseUrl || token))
        : base.enabled,
      baseUrl,
      token,
      model: overrides?.model ?? base.model,
      provider: (overrides?.protocol ?? base.provider).trim().toLowerCase(),
      timeoutMs: base.timeoutMs,
    };
    const result = await this.probe(modality, cfg);
    return {
      ...result,
      testedAt: new Date().toISOString(),
      target: overrides ? 'draft' : 'saved',
    };
  }

  /**
   * 拉取某模态当前配置（或草稿）对应的厂商模型清单。
   *
   * ## 为什么需要
   *
   * 模型名是**手填**的, 而运营通常不知道该厂商到底提供哪些模型 ——
   * 只能翻厂商控制台或抄旧教程, 抄错的表现是「连通测试通过、生成永远 404」。
   * 本方法把连通性测试里已经在用的 `modelListEndpoints` + `fetchModelIds`
   * 单独暴露出来, 让后台页面能把真实模型清单**列出来给运营选**。
   *
   * ## 为什么返回 null 而不抛错
   *
   * 「拉不到清单」与「清单是空的」是两件事:
   *   - 接口不可达/未开放 → null, 页面继续用内置预设, 不影响手填;
   *   - 拉到空数组       → 确定该厂商当前没有可用模型, 需要提示。
   * 抛错会把「无法验证」渲染成「配置错误」, 反而误导排障。
   *
   * @param modality 目标模态（各模态基址/令牌/协议独立）
   * @param overrides 草稿覆盖值；未传则读当前生效配置
   */
  async listModels(
    modality: Modality,
    overrides?: ConnectionOverrides,
  ): Promise<{ endpoints: string[]; ids: string[] | null; message: string }> {
    const base = gatewayConfigOf(modality);
    const token = overrides?.token !== undefined ? overrides.token : base.token;
    const baseUrl = normalizeBaseUrl(overrides?.baseUrl ?? base.baseUrl);
    const provider = (overrides?.protocol ?? base.provider).trim().toLowerCase();

    if (!baseUrl) {
      return { endpoints: [], ids: null, message: '缺少接入地址，无法拉取厂商模型清单' };
    }
    if (!protocolSupports(modality, provider)) {
      return { endpoints: [], ids: null, message: `协议 "${provider}" 尚未接入本项目，无法拉取模型清单` };
    }

    const spec = protocolSpec(provider);
    const videoSpec = videoProtocolSpec(provider);
    const endpoints = spec?.modelListEndpoints?.(baseUrl) ?? videoSpec?.modelListEndpoints?.(baseUrl) ?? [];
    if (endpoints.length === 0) {
      return {
        endpoints,
        ids: null,
        message: '该厂商未提供模型列表接口，只能手填模型名（可先用「测试这条草稿」校验）',
      };
    }

    const ids = await this.fetchModelIds(endpoints, token, Math.min(base.timeoutMs, 15000));
    if (!ids) {
      return {
        endpoints,
        ids: null,
        message: '模型列表接口不可达 —— 可能是令牌无效、无该接口权限，或需要先保存线路',
      };
    }
    return {
      endpoints,
      ids,
      message: ids.length > 0 ? `已拉取 ${ids.length} 个模型` : '接口返回了空列表，请确认该账号下是否有可用模型',
    };
  }

  /** 实际探测逻辑（不关心来源是已保存配置还是草稿） */
  private async probe(
    modality: Modality,
    cfg: {
      enabled: boolean;
      baseUrl: string;
      token: string;
      model: string;
      provider: string;
      timeoutMs: number;
    },
  ): Promise<{ ok: boolean; latencyMs: number; message: string; detail?: string }> {
    const startedAt = Date.now();

    if (!cfg.enabled) {
      return {
        ok: false,
        latencyMs: 0,
        message: `${modalityLabel(modality)}通道未启用`,
        detail: '请先填写该模态的网关基址或令牌, 或打开「强制启用远程通道」',
      };
    }
    if (!cfg.baseUrl) {
      return { ok: false, latencyMs: 0, message: `缺少${modalityLabel(modality)}网关基址`, detail: '无法构造请求地址' };
    }
    if (!protocolSupports(modality, cfg.provider)) {
      return {
        ok: false,
        latencyMs: 0,
        message: `${modalityLabel(modality)}协议未接入`,
        detail: `协议 "${cfg.provider}" 在本项目的${modalityLabel(modality)}通道下尚无实现, 生成时会直接失败。请在厂商预设中选择已接入的协议`,
      };
    }

    /*
     * ⚠️ 探测路径必须**由协议层派生**, 不能按模态硬编码 (2026-10-20 修)。
     *
     * 改造前这里是 `probePath(modality)`: image 恒打一条硬编码的固定路径 ——
     * 而三个图像协议的真实端点各不相同:
     *   openai → /v1/images/generations
     *   volcengine → /images/generations
     *   minimax → /v1/image_generation
     *
     * 于是配了 openai 协议时, 探测打的是优云智算/硅基流动**根本不存在**的
     * 固定路径, 拿到 404, 而探测把 4xx 当作「网络可达」→
     * **测试显示通过, 但生成必然 404**。
     *
     * 症状与本项目最忌讳的「静默不实」完全一致: 运营看到绿色对勾,
     * 却每次生成都失败, 且从界面上看不出任何原因。
     */
    const spec = protocolSpec(cfg.provider);
    const videoSpec = videoProtocolSpec(cfg.provider);
    const path = spec
      ? (spec.probePath?.(cfg.baseUrl) ?? pathOf(spec.endpoint(cfg.baseUrl)))
      : videoSpec
        ? (videoSpec.probePath?.(cfg.baseUrl) ?? pathOf(videoSpec.submitEndpoint(cfg.baseUrl)))
        : probePath(modality);

    let reachable: { ok: boolean; latencyMs: number; message: string; detail?: string };
    try {
      const url = `${cfg.baseUrl}${path}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(cfg.timeoutMs, 15000));
      try {
        // OPTIONS 探活: 能往返即证明网络可达, 且不消耗模型额度、不产生垃圾产出
        const res = await fetch(url, {
          method: 'OPTIONS',
          headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
          signal: ctrl.signal,
        });
        const latencyMs = Date.now() - startedAt;
        /*
         * ⚠️ 状态码要**分档**, 不能把 4xx 一律当「网络可达」 (2026-10-20 修)。
         *
         * 改造前: 任何 4xx 都算 ok:true「网络可达」。于是:
         *   - 令牌无效 (401/403) → 显示通过, 生成却必然被拒
         *   - 路径不存在 (404)     → 显示通过, 生成却必然 404
         * 这两类都是**真问题**, 报「可达」等于谎报。
         *
         * 分档依据 (OPTIONS 语义):
         *   2xx        → 端点存在且接受该方法
         *   405/501    → **端点确实存在**, 只是不接受 OPTIONS —— 强正向信号
         *   401/403    → 端点存在, 但**令牌被拒** —— 真问题, 必须报失败
         *   404        → 端点不存在 (或该服务器不处理 OPTIONS) —— **存疑**,
         *                不能算通过, 也不能直接算失败 (要靠模型列表交叉验证)
         *   其他 4xx   → 存疑, 同 404
         *   5xx        → 网关自身故障 → 失败
         */
        if (res.ok) {
          reachable = { ok: true, latencyMs, message: `连通正常 (HTTP ${res.status})` };
        } else if (res.status === 405 || res.status === 501) {
          reachable = {
            ok: true,
            latencyMs,
            message: `端点存在 (HTTP ${res.status}, 不接受探测方法)`,
            detail: `${path} 已确认存在, 实际生成将走 POST ${path}`,
          };
        } else if (res.status === 401 || res.status === 403) {
          reachable = {
            ok: false,
            latencyMs,
            message: `令牌被拒绝 (HTTP ${res.status})`,
            detail: `${path} 已确认存在, 但拒绝当前令牌 —— 令牌无效、已过期, 或无该模型的权限。生成时必然失败。`,
          };
        } else if (res.status < 500) {
          /*
           * 404 (或其他存疑 4xx): **不能就此判通过**。
           *
           * 可能是两种情况, 后果完全相反:
           *   a) 该服务器不处理 OPTIONS → 配置其实是对的
           *   b) 路径根本不存在        → 生成必然 404
           * 报「通过」会掩盖 (b), 那正是本缺陷的形状。
           *
           * 故**换 GET 再探一次** —— 端点是 POST-only 的生成接口, 用 GET 打它:
           *   405 Method Not Allowed → 端点确实存在 (只是方法不对) → 通过
           *   2xx/401/403           → 端点存在 → 通过 (401/403 已在上面单独处理)
           *   404                   → 端点真的不存在 → 失败
           *
           * ⚠️ GET 不会触发生成: 生成端点只接受 POST, GET 只用于确认路径存在。
           */
          const viaGet = await probeWithGet(url, cfg.token, Math.min(cfg.timeoutMs, 15000));
          if (viaGet === 405) {
            reachable = {
              ok: true,
              latencyMs: Date.now() - startedAt,
              message: `端点存在 (HTTP ${res.status}/${viaGet}, 不接受探测方法)`,
              detail: `${path} 已确认存在, 实际生成将走 POST ${path}`,
            };
          } else if (viaGet === 404) {
            /*
             * ⚠️ OPTIONS + GET 都 404 **仍不能判定端点不存在**。
             *
             * 实测 (2026-10-20, api.modelverse.cn):
             *   OPTIONS /v1/images/generations → 404
             *   GET     /v1/images/generations → 404
             *   POST    /v1/images/generations → 401  ← 端点真实存在
             * 生成接口常常只注册 POST，服务器对其它方法直接 404。
             * 故补一次**空请求体 POST**：不会带上图片/提示词，不会触发生成；
             * 404 才是真不存在，400/401/403/405/422 都说明路径存在。
             */
            const viaPost = await probeWithPost(url, cfg.token, Math.min(cfg.timeoutMs, 15000));
            if (viaPost === 404) {
              reachable = {
                ok: false,
                latencyMs: Date.now() - startedAt,
                message: `端点不存在 (HTTP ${viaPost})`,
                detail: `${path} 用 OPTIONS、GET、POST 三种方法探测都是 404 —— 该路径在服务器上不存在。可能是基址填错 (本项目只存根域, 别带 /v1), 或该厂商的端点与所选协议不匹配。生成时必然 404。`,
              };
            } else if (viaPost === 401 || viaPost === 403) {
              reachable = {
                ok: false,
                latencyMs: Date.now() - startedAt,
                message: `令牌被拒绝 (HTTP ${viaPost})`,
                detail: `${path} 已确认存在（只接受 POST），但拒绝当前令牌。生成时必然失败。`,
              };
            } else if (viaPost >= 500) {
              reachable = {
                ok: false,
                latencyMs: Date.now() - startedAt,
                message: `网关返回 HTTP ${viaPost}`,
                detail: `端点存在，但服务器自身故障。${path}`,
              };
            } else if (viaPost === 0) {
              reachable = {
                ok: false,
                latencyMs: Date.now() - startedAt,
                message: '无法连接网关',
                detail: `${path} 的 POST 探测没有响应（超时或网络错误）。`,
              };
            } else {
              reachable = {
                ok: true,
                latencyMs: Date.now() - startedAt,
                message: `端点存在 (只有 POST 被接受, 探测得到 HTTP ${viaPost})`,
                detail: `${path} 已确认存在；该接口只注册了 POST，空请求体探测返回 ${viaPost}，不会触发一次生成。`,
              };
            }
          } else if (viaGet === 401 || viaGet === 403) {
            reachable = {
              ok: false,
              latencyMs: Date.now() - startedAt,
              message: `令牌被拒绝 (HTTP ${viaGet})`,
              detail: `${path} 已确认存在, 但拒绝当前令牌 —— 令牌无效、已过期, 或无该模型的权限。生成时必然失败。`,
            };
          } else {
            reachable = {
              ok: true,
              latencyMs: Date.now() - startedAt,
              message: `网络可达但端点存疑 (HTTP ${res.status})`,
              detail: `${path} 返回 ${res.status}, 换 GET 探测得到 ${viaGet}。网络是通的, 但无法确认该路径存在 —— 可能是该服务器不处理探测请求。实际生成将走 POST ${path}`,
            };
          }
        } else {
          reachable = { ok: false, latencyMs, message: `网关返回 HTTP ${res.status}`, detail: await safeText(res) };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      reachable = {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: `无法连接${modalityLabel(modality)}网关`,
        detail: (e as Error).message,
      };
    }

    if (!reachable.ok) return reachable;

    /*
     * 网络可达 ≠ 模型可用 (2026-10-20)。
     *
     * 模型名写错是**最高频**的配错 (抄旧教程、填了已下线的模型)。
     * 症状: 探测通过但生成必然失败, 且用户完全看不出原因 ——
     * 正是 Teable 说的「测试方式必须与模态匹配」所要防的那类。
     *
     * 故再拉一次模型列表, 检查配置的模型名在不在里面。
     * 拉不到列表 (该厂商不提供) 时**不报错** —— 那只是「无法验证」,
     * 不是「验证失败」, 两者必须区分, 否则会把正常配置判成错误。
     */
    const model = cfg.model?.trim();
    if (!model) return reachable;

    const listEndpoints = spec?.modelListEndpoints?.(cfg.baseUrl) ?? videoSpec?.modelListEndpoints?.(cfg.baseUrl);
    if (!listEndpoints || listEndpoints.length === 0) {
      // 该协议/厂商不提供模型列表 → 只能验到「网络可达」
      return {
        ...reachable,
        message: `${reachable.message} · 未验模型名`,
        detail: `${reachable.detail ? reachable.detail + ' ' : ''}该厂商未提供模型列表接口, 无法校验模型名 "${model}" 是否存在。模型名填错时探测仍会通过, 但生成会失败。`,
      };
    }

    const listed = await this.fetchModelIds(listEndpoints, cfg.token, Math.min(cfg.timeoutMs, 15000));
    if (!listed) {
      return {
        ...reachable,
        message: `${reachable.message} · 未验模型名`,
        detail: `${reachable.detail ? reachable.detail + ' ' : ''}模型列表接口不可达, 无法校验模型名 "${model}"。`,
      };
    }

    if (listed.includes(model)) {
      return {
        ...reachable,
        message: `${reachable.message} · 模型可用`,
        detail: `${reachable.detail ? reachable.detail + ' ' : ''}模型 "${model}" 在该厂商的可用模型列表中。`,
      };
    }

    /*
     * ⚠️ 模型不在列表里 —— 这是一个**真问题**, 必须报失败。
     *
     * 之前探测只看网络, 于是「模型名写错」表现为「测试通过但生成永远失败」,
     * 运营完全无从排查。现在明确告诉它: 模型名不在可用列表里。
     *
     * 注意要给出会话内**可用的模型名样例** —— 只说「不在列表里」,
     * 运营还是不知道该填什么。
     */
    return {
      ok: false,
      latencyMs: reachable.latencyMs,
      message: `模型 "${model}" 不在该厂商的可用模型列表中`,
      detail: `网络可达, 但按模型名 "${model}" 调用会失败。该厂商当前可用: ${listed.slice(0, 8).join(', ')}${listed.length > 8 ? ` 等 ${listed.length} 个` : ''}。请从厂商模型广场复制准确 id。`,
    };
  }

  /**
   * 批量连通性测试 —— 一次测完所有模态 (2026-10-20)。
   *
   * ## 为什么需要
   *
   * 三个模态各有独立的基址/令牌/协议, 运营改完一个通道常常忘了另一个 ——
   * 而「忘了配」在页面上是**看不出来的** (视频/文本未接入 = 无兜底 = 调用必失败)。
   * 逐个模态点「测试」既慢又容易漏, 于是 New API 那种「Test All Channels」
   * 的一键全测是这里最该抄的一条。
   *
   * ## 为什么并发
   *
   * 三个探测互不依赖, 串行要等 3 倍时间 (每个最长 15s 超时)。
   * 并发后总耗时 ≈ 最慢的那一个。⚠️ 但**不能**无限并发 ——
   * 将来模态多了会有几十个, 故用 Promise.allSettled (失败不互相影响)
   * 且每个探测自带超时。
   *
   * 失败不抛错: 批量测试的目的就是「一次看全」, 某个模态失败不该
   * 让其它模态的结果也拿不到。故用 allSettled 而非 all。
   */
  async testAllConnections(): Promise<{
    results: Record<string, { ok: boolean; latencyMs: number; message: string; detail?: string }>;
    okCount: number;
    total: number;
    elapsedMs: number;
  }> {
    const startedAt = Date.now();
    const modalities = MODALITIES.map((m) => m.value);
    const settled = await Promise.allSettled(
      modalities.map((modality) => this.testConnection(modality)),
    );
    const results: Record<
      string,
      { ok: boolean; latencyMs: number; message: string; detail?: string }
    > = {};
    settled.forEach((r, i) => {
      const modality = modalities[i];
      if (r.status === 'fulfilled') {
        results[modality] = r.value;
      } else {
        // 理论上 testConnection 内部已吞掉异常, 走到这里是兜底
        results[modality] = {
          ok: false,
          latencyMs: 0,
          message: '测试过程异常',
          detail: String((r as PromiseRejectedResult).reason?.message ?? r.reason),
        };
      }
    });
    return {
      results,
      okCount: Object.values(results).filter((r) => r.ok).length,
      total: modalities.length,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /**
   * 依次尝试候选端点拉模型列表, 返回模型 id 数组。
   *
   * ⚠️ 为什么要「候选」: 同一个协议被多家厂商复用, 而各家的模型列表路径
   * 不统一 (DeepSeek 是 {base}/models 没有 /v1, 其余是 {base}/v1/models)。
   * 猜一个统一路径必然对某家不对 —— 猜错 = 静默漏检, 比不检更坏。
   *
   * 返回 null = 全部端点都不可达 (无法验证), 与「拉到但列表为空」要区分:
   * 前者是不确定, 后者是确定没有。
   */
  private async fetchModelIds(
    endpoints: string[],
    token: string | undefined,
    timeoutMs: number,
  ): Promise<string[] | null> {
    for (const url of endpoints) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: ctrl.signal,
        });
        if (!res.ok) continue;
        const json = await res.json();
        const ids = extractModelIds(json);
        if (ids) return ids;
      } catch {
        // 试下一个候选
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }
}

/**
 * 各模态的探活路径 —— **兜底**, 仅当协议层未声明时使用。
 *
 * ⚠️ 正常路径应来自协议层 (spec.probePath ?? spec.endpoint 的路径)。
 * 本函数只是「协议层没查到」时的最后兜底, 精度低于协议层声明。
 * 保留它是为了让「协议未接入」的分支也能给出一条像样的提示, 而不是崩溃。
 */
function probePath(modality: Modality): string {
  switch (modality) {
    case 'text':
      return '/v1/chat/completions';
    case 'video':
      return '/v1/videos';
    default:
      // 图像协议都能在协议层查到 spec, 本分支实际不可达;
      // 取默认协议 (openai) 的端点, 与 gateway.config 的默认值保持一致。
      return '/v1/images/generations';
  }
}

/**
 * 用 GET 再探一次, 返回 HTTP 状态码 (网络错误返回 0)。
 *
 * 用途: 区分「端点不存在 (404)」与「端点存在但方法不对 (405)」。
 * 详见 testConnection 里的注释。
 */
async function probeWithGet(url: string, token: string | undefined, timeoutMs: number): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: ctrl.signal,
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 用**空请求体 POST** 再探一次，返回状态码（网络错误返回 0）。
 *
 * 仅当 OPTIONS 与 GET 都是 404 时使用。生成接口常只注册 POST，
 * 服务器对其它方法一律 404；空 body 缺少提示词/图片，正常厂商会以
 * 400/401/403/405/422 拒绝，而不会真的生成一次。
 */
async function probeWithPost(url: string, token: string | undefined, timeoutMs: number): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
      signal: ctrl.signal,
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** 从完整 URL 里取路径部分 (用于把协议层给的完整 URL 变成可拼的相对路径) */
function pathOf(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    return `${u.pathname}${u.search}`;
  } catch {
    return fullUrl;
  }
}

/**
 * 从模型列表响应里提取模型 id 数组。
 *
 * 覆盖的形状 (取证):
 *   OpenAI 兼容  { object:'list', data:[{ id }] }
 *   DeepSeek     { object:'list', data:[{ id }] }   同上
 *   火山方舟      { data:[{ id }] }                   同上 (无 object 字段)
 *   部分厂商      { models:[{ id }] } / { data:[{ model }] }
 *
 * 返回 null = 形状不认识 (而非"没有模型") —— 两者必须区分:
 * 形状不认识时**不能**判定"模型名不在列表里" (那会误报)。
 */
function extractModelIds(json: any): string[] | null {
  const arrays = [json?.data, json?.models, json?.result?.data, json?.body?.data];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    const ids: string[] = [];
    for (const item of arr) {
      if (typeof item === 'string') {
        ids.push(item);
        continue;
      }
      const id = item?.id ?? item?.model ?? item?.name;
      if (typeof id === 'string' && id) ids.push(id);
    }
    if (ids.length > 0) return ids;
  }
  return null;
}

function modalityLabel(modality: Modality): string {
  return MODALITIES.find((m) => m.value === modality)?.label ?? modality;
}

/** 凭据脱敏: 只保留首 4 与末 4, 中间固定长度遮罩 */
function mask(raw: string): string {
  if (raw.length <= 8) return '*'.repeat(raw.length);
  return `${raw.slice(0, 4)}${'*'.repeat(Math.max(4, raw.length - 8))}${raw.slice(-4)}`;
}

/** 基址脱敏: 只露协议与主机, 抹掉路径 (路径里常带版本号/租户标识) */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : '/***'}`;
  } catch {
    return '***';
  }
}

/** 取该项的生效值 (env 来源时读 env, 否则读 DB 覆盖, 都没有就是默认值) */
function effective(def: ConfigDef, source: string, dbRaw?: string): string | number | boolean {
  if (source === 'env' && def.envName) {
    const raw = process.env[def.envName] as string | undefined;
    if (def.type === 'number') return Number(raw) || Number(def.default);
    return raw ?? def.default;
  }
  if (source === 'db' && dbRaw !== undefined) {
    if (def.type === 'number') return Number(dbRaw) || Number(def.default);
    if (def.type === 'boolean') return dbRaw === 'true' || dbRaw === '1';
    return dbRaw;
  }
  return def.default;
}

/** 按 ConfigDef 校验并归一化 (service 层二次校验, 防绕过前端直调接口) */
function validate(def: ConfigDef, raw: unknown): string {
  if (def.type === 'boolean') {
    if (typeof raw === 'boolean') return String(raw);
    if (raw === 'true' || raw === '1') return 'true';
    if (raw === 'false' || raw === '0') return 'false';
    throw new AppError(40001, `${def.label} 必须是布尔值`, 400);
  }

  if (def.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new AppError(40001, `${def.label} 必须是数字`, 400);
    if (def.min !== undefined && n < def.min) throw new AppError(40001, `${def.label} 不得小于 ${def.min}`, 400);
    if (def.max !== undefined && n > def.max) throw new AppError(40001, `${def.label} 不得大于 ${def.max}`, 400);
    return String(n);
  }

  const s = String(raw ?? '').trim();
  if (def.maxLength !== undefined && s.length > def.maxLength) {
    throw new AppError(40001, `${def.label} 长度不得超过 ${def.maxLength}`, 400);
  }
  /*
   * 网关基址: 只存厂商根域, /v1 由协议层补 (2026-10-23 补)。
   *
   * 照抄厂商文档的 `https://api.x.com/v1` 会让协议层拼出 /v1/v1/...,
   * 上游回 404 api_route_not_found, 而生成侧只能报「通道全部失败」——
   * 2026-10-23 的 a6api 线路就是这么挂的。这里**归一化后落库**并回给调用方,
   * 运营在页面上看到的地址与实际生效的地址始终是同一个值。
   * 规则与模型线路共用 providers/base-url.ts, 不在这里另写一份。
   */
  if (def.key.endsWith('.baseUrl')) {
    const issue = baseUrlIssue(s, { required: false });
    if (issue) throw new AppError(40001, `${def.label}: ${issue}`, 400);
    return normalizeBaseUrl(s);
  }
  if (def.key.startsWith('gateway.route.')) {
    if (!(ROUTE_VALUES as readonly string[]).includes(s)) {
      throw new AppError(40001, `${def.label} 只能是 auto / local / remote`, 400);
    }
    /*
     * 「强制本地」只对**本地真有实现**的能力成立 (2026-10-22 补)。
     *
     * 本地没有实现的能力 (创意生图 / 局部重绘 / 图片翻译 / 自由创作, 即
     * allowsLocalFallback() 为 false 或压根没有 localImpl) 压到 local 是
     * 一个**不可能成立**的配置: 路由器对这种组合直接判 no-channel → 42204 + 退款,
     * C 端 /capabilities 则报 effective=unavailable。而运营在后台看到的只是一句
     * 「保存成功」, 随后用户点进去才发现按钮是死的 —— 这正是本项目最忌讳的
     * 「保存了但静默失效」。
     *
     * 判定与路由器、availability、routeEffectiveOf 共用 allowsLocalFallback(),
     * 不在这里另写一份, 否则四处口径迟早分叉。
     */
    if (s === 'local') {
      const cap = CAPABILITIES.find((c) => c.id === def.key.slice('gateway.route.'.length));
      if (cap && !(cap.localImpl && allowsLocalFallback(cap))) {
        throw new AppError(
          40001,
          `${cap.name} 本地没有实现，不能强制本地（按下去会直接失败并退款），请改为 auto 或 remote`,
          400,
        );
      }
    }
  }
  // 通道协议必须在本模态的已接入白名单内。
  // ⚠️ 这条校验是本次改造刻意新增的: 协议名跨模态复用 (openai 既是生图也是文本),
  // 放行跨模态协议会让文生文请求被发到生图端点 —— 404 → 静默回落本地,
  // 运营在界面上完全看不出配错了。
  if (def.key.endsWith('.provider') && s) {
    const modality = def.modality;
    if (modality && !protocolSupports(modality, s)) {
      const allowed = PROTOCOL_OPTIONS_BY_MODALITY[modality].map((o) => o.value);
      throw new AppError(
        40001,
        allowed.length
          ? `${def.label} 只能是 ${allowed.join(' / ')}`
          : `${def.label} 所属模态尚未接入任何协议, 无法保存`,
        400,
      );
    }
  }
  return s;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 180);
  } catch {
    return '';
  }
}