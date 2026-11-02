/**
 * 协议目录 —— 后台「渠道模型」表单的协议来源与保存校验的单一入口。
 *
 * 两个数据源按优先级合并：
 *   1. `ProtocolRegistry`：已注册的运行时适配器（P2 起内置 + 插件编译产物）；
 *   2. `PluginManifestStore`：随代码入库的插件清单（P1 阶段只有它可用）。
 *
 * 为什么保存期必须校验协议能力：DeepSeek / Moonshot 标称「OpenAI 兼容」只指
 * `/v1/chat/completions` 的**文本**兼容，把它们配到生图通道必然 404 —— 这类
 * 错误在保存时就能判定，不该等到用户任务失败退款。
 *
 * 能力匹配看 `capability`，不看协议名：同名协议可能跨模态复用。
 */

import { Injectable } from '@nestjs/common';
import { ModelDomainError } from '../domain/json';
import { PluginManifestStore } from '../plugins/plugin-manifest.store';
import { ProtocolRegistry } from './registry';
import type { ManifestCapability, ManifestImageParameter, ManifestProvider } from './types';

/** 后台渠道可挂载的表面（参考实现 `ManifestSurface`） */
export const ADMIN_SURFACE = 'admin.system-channel';
export const USER_SURFACE = 'user.custom-channel';

export interface ProtocolCatalogEntry {
  id: string;
  label: string;
  capabilities: ManifestCapability[];
  /** 'generation' | 'processing' */
  kind: string;
  /** 是否支持异步轮询 */
  async: boolean;
  /** 是否需要渠道同时配置 Secret Key（AWS SigV4 / 火山 v4 / 腾讯 TC3） */
  requiresSecretKey: boolean;
  source: 'registry' | 'manifest';
  /** 所属插件；内置适配器为 `builtin` */
  pluginId: string;
  /** 是否可被后台渠道选用 */
  selectable: boolean;
  /** 清单声明的可挂载表面；空数组 = 未声明（视为可挂载） */
  surfaces: string[];
  /** 协议声明的图片参数合同（渠道模型默认能力配置的来源） */
  imageParameters: ManifestImageParameter[];
}

@Injectable()
export class ProtocolCatalogService {
  private cache: Map<string, ProtocolCatalogEntry> | null = null;

  constructor(
    private readonly registry: ProtocolRegistry,
    private readonly plugins: PluginManifestStore,
  ) {}

  /** 插件安装/卸载后调用 */
  invalidate(): void {
    this.cache = null;
  }

  /** 全部可选协议（可按能力 / 挂载表面过滤） */
  list(capability?: string, surface: string = ADMIN_SURFACE): ProtocolCatalogEntry[] {
    const result: ProtocolCatalogEntry[] = [];
    for (const entry of this.entries().values()) {
      if (!entry.selectable) continue;
      if (capability && !entry.capabilities.includes(capability as ManifestCapability)) continue;
      if (surface && entry.surfaces.length > 0 && !entry.surfaces.includes(surface)) continue;
      result.push(entry);
    }
    return result.sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'));
  }

  get(id: string): ProtocolCatalogEntry | null {
    return this.entries().get(String(id ?? '').trim()) ?? null;
  }

  /**
   * 保存渠道模型时的协议校验：必须存在、必须是生成类、能力必须匹配。
   * 返回协议元数据（含是否需要 Secret Key），由调用方做凭证校验。
   */
  require(id: string, capability: string): ProtocolCatalogEntry {
    const entry = this.get(id);
    if (!entry) throw new ModelDomainError(`未知的模型请求协议：${id}`);
    if (entry.kind === 'processing') {
      throw new ModelDomainError('处理类协议不能作为生成渠道模型');
    }
    if (capability && !entry.capabilities.includes(capability as ManifestCapability)) {
      throw new ModelDomainError(`协议 ${entry.label} 不支持 ${capability} 能力`);
    }
    return entry;
  }

  private entries(): Map<string, ProtocolCatalogEntry> {
    if (this.cache) return this.cache;
    const result = new Map<string, ProtocolCatalogEntry>();

    // 1. 插件清单（基础层；同名 protocol 合并能力，先到先得）
    for (const item of this.plugins.providers()) {
      const provider: ManifestProvider = item.provider;
      const id = String(provider.id ?? '').trim();
      if (!id) continue;
      const existing = result.get(id);
      if (existing) {
        for (const capability of provider.capabilities ?? []) {
          if (!existing.capabilities.includes(capability)) existing.capabilities.push(capability);
        }
        continue;
      }
      result.set(id, {
        id,
        label: String(provider.label ?? id),
        capabilities: [...(provider.capabilities ?? [])],
        kind: String(provider.kind ?? 'generation'),
        async: Boolean(provider.poll),
        requiresSecretKey: Boolean(String(provider.auth?.secretField ?? '').trim()),
        source: 'manifest',
        pluginId: item.pluginId,
        selectable: true,
        surfaces: [...(provider.scopes ?? [])],
        imageParameters: [...(provider.imageParameters ?? [])],
      });
    }

    // 2. 已注册的运行时适配器覆盖同名清单项
    for (const metadata of this.registry.list()) {
      const existing = result.get(metadata.id);
      result.set(metadata.id, {
        id: metadata.id,
        label: metadata.label,
        capabilities: metadata.capabilities,
        kind: metadata.kind,
        async: metadata.async,
        requiresSecretKey: existing?.requiresSecretKey ?? false,
        source: 'registry',
        pluginId: metadata.pluginId ?? (metadata.source === 'builtin' ? 'builtin' : ''),
        selectable: true,
        surfaces: existing?.surfaces ?? [],
        imageParameters: metadata.imageParameters ?? existing?.imageParameters ?? [],
      });
    }

    this.cache = result;
    return result;
  }
}
