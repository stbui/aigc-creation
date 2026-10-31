/**
 * 把内置插件清单注册成运行时协议。
 *
 * 移植自 open-ai-canvas `LoadInstalledProviders`：一个插件包可以贡献多个
 * provider，每个 provider 是独立的执行项；清单没有 provider 贡献时（纯
 * 支付 / 短信 / 工作流插件）不注册任何协议。
 *
 * 失败策略与清单加载一致：**随代码发布的协议注册失败 = 发布阻断**，直接
 * 抛出并指名插件与 provider。运行期不会出现「协议列在后台、实际没有实现」
 * 的静默错配 —— 那种错配只会在用户任务失败时才暴露。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginManifestStore } from '../plugins/plugin-manifest.store';
import { createManifestAdapter } from './manifest-adapter';
import { ProtocolRegistry } from './registry';
import type { ProtocolAdapter } from './runtime';

export interface ProtocolRegistrationSnapshot {
  registered: number;
  /** 声明了 `host:<name>` 但没有宿主执行引擎的 provider（当前应为空） */
  hostBacked: string[];
  /** 没有 provider 贡献的插件（支付 / 短信 / 工作流） */
  skippedPlugins: string[];
  /** 后台停用的插件：清单仍在，但不注册协议（停用必须对运行期生效） */
  disabledPlugins: string[];
}

@Injectable()
export class PluginProtocolService implements OnModuleInit {
  private readonly log = new Logger(PluginProtocolService.name);
  private snapshot: ProtocolRegistrationSnapshot = {
    registered: 0,
    hostBacked: [],
    skippedPlugins: [],
    disabledPlugins: [],
  };

  constructor(
    private readonly registry: ProtocolRegistry,
    private readonly plugins: PluginManifestStore,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.registerAll();
  }

  /**
   * 注册全部插件协议；可重复调用（后台启停插件后刷新注册表）。
   *
   * 停用状态读库而不是只在内存里记：否则重启会把管理员停用的插件重新注册回来，
   * 「停用」就只在本次进程内有效，这类偏差在线上几乎无法被发现。
   */
  async registerAll(): Promise<ProtocolRegistrationSnapshot> {
    const registered: ProtocolAdapter[] = [];
    const hostBacked: string[] = [];
    const skippedPlugins: string[] = [];
    const disabledPlugins: string[] = [];
    const seen = new Set<string>();
    const disabled = await this.disabledPluginIds();

    for (const plugin of this.plugins.list()) {
      const pluginId = plugin.manifest.metadata.id;
      if (disabled.has(pluginId)) {
        disabledPlugins.push(pluginId);
        continue;
      }
      const providers = plugin.manifest.contributes?.providers ?? [];
      if (providers.length === 0) {
        skippedPlugins.push(pluginId);
        continue;
      }
      const backend = String(plugin.manifest.runtime?.backend ?? 'declarative').trim() || 'declarative';
      // `host:<name>` 表示由宿主原生实现接管执行；本仓尚未内置这类引擎，
      // 清单仍可展示，但不注册适配器（注册一个不存在的执行器只会让任务空转）。
      if (backend.startsWith('host:')) {
        hostBacked.push(`${plugin.manifest.metadata.id}:${backend}`);
        continue;
      }
      providers.forEach((provider, index) => {
        if (seen.has(provider.id)) {
          throw new Error(`协议 id 重复：${provider.id}（插件 ${plugin.manifest.metadata.id}）`);
        }
        seen.add(provider.id);
        try {
          registered.push(createManifestAdapter(plugin.manifest, index));
        } catch (error) {
          throw new Error(
            `插件协议注册失败（${plugin.manifest.metadata.id}/${provider.id}）：${(error as Error).message}`,
          );
        }
      });
    }

    // 停用的插件必须在注册表里被摘掉：只跳过注册而不移除，会让上次注册的适配器继续生效
    for (const pluginId of disabledPlugins) this.registry.removeByPlugin(pluginId);
    for (const adapter of registered) this.registry.register(adapter, { replace: true });
    this.snapshot = { registered: registered.length, hostBacked, skippedPlugins, disabledPlugins };
    this.log.log(
      `已注册插件协议 ${registered.length} 个` +
        (skippedPlugins.length > 0 ? `（${skippedPlugins.length} 个插件无 provider 贡献）` : '') +
        (disabledPlugins.length > 0 ? `（${disabledPlugins.length} 个插件已被停用）` : ''),
    );
    if (hostBacked.length > 0) {
      this.log.warn(`以下 provider 声明了宿主执行引擎，当前未注册：${hostBacked.join(', ')}`);
    }
    return this.snapshot;
  }

  /** 最近一次注册结果（后台插件页展示用） */
  status(): ProtocolRegistrationSnapshot {
    return {
      ...this.snapshot,
      hostBacked: [...this.snapshot.hostBacked],
      skippedPlugins: [...this.snapshot.skippedPlugins],
      disabledPlugins: [...this.snapshot.disabledPlugins],
    };
  }

  /** 后台停用的插件 id；读失败不能当成「全部停用」，直接抛出由调用方处理 */
  private async disabledPluginIds(): Promise<Set<string>> {
    const rows = await this.prisma.pluginPlatformState.findMany({
      where: { enabled: false },
      select: { pluginId: true },
    });
    return new Set(rows.map((row) => row.pluginId));
  }
}
