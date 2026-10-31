/**
 * 协议注册表 —— 渠道模型保存与运行期派发都以它为准。
 *
 * 移植自 open-ai-canvas `internal/protocol/registry.go`。两条硬约束：
 * 1. **未知协议在保存时拒绝**，运行期绝不静默替换成别的协议；
 * 2. 注册表是唯一事实源，后台下拉、能力校验、调度解析都读它，不存在第二份清单。
 *
 * 执行契约定义在 `runtime.ts`（适配器、请求形态、结果形态），这里只做
 * 注册、别名解析与按能力检索。声明式插件由 `manifest-adapter.ts` 注册，
 * 内置协议由 `builtin/` 注册，二者对上层完全等价。
 */

import { Injectable, Logger } from '@nestjs/common';
import type { ManifestCapability } from './types';
import type { ProtocolAdapter, ProtocolMetadata } from './runtime';

export type {
  ProtocolAdapter,
  ProtocolMetadata,
  ProtocolRequestSpec,
  ProtocolCreateResult,
  ProtocolPollResult,
  ProtocolResult,
  ProtocolStatus,
  MediaReference,
} from './runtime';

/** 注册表：id → adapter，兼带历史别名 */
@Injectable()
export class ProtocolRegistry {
  private readonly log = new Logger(ProtocolRegistry.name);
  private readonly adapters = new Map<string, ProtocolAdapter>();
  private readonly aliases = new Map<string, string>();

  /** 注册协议；重复注册视为装配错误（同一 id 不允许两个实现） */
  register(adapter: ProtocolAdapter, options: { replace?: boolean } = {}): void {
    const id = adapter.metadata?.id;
    if (!id) throw new Error('协议 id 不能为空');
    if (this.adapters.has(id) && !options.replace) {
      throw new Error(`协议重复注册：${id}`);
    }
    this.adapters.set(id, adapter);
  }

  /** 注册历史别名（如 modelverse → openai），解析时透明映射 */
  registerAlias(alias: string, target: string): void {
    if (!alias || !target || alias === target) return;
    this.aliases.set(alias, target);
  }

  /** 解析协议；不存在返回 null，由调用方决定拒绝还是失败 */
  resolve(id: string): ProtocolAdapter | null {
    const key = String(id ?? '').trim();
    if (!key) return null;
    const direct = this.adapters.get(key);
    if (direct) return direct;
    const alias = this.aliases.get(key);
    return alias ? this.adapters.get(alias) ?? null : null;
  }

  has(id: string): boolean {
    return this.resolve(id) !== null;
  }

  /** 全部协议元数据（后台下拉与能力校验） */
  list(): ProtocolMetadata[] {
    return [...this.adapters.values()]
      .map((adapter) => adapter.metadata)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** 按能力过滤（渠道模型保存时校验「协议是否支持该能力」） */
  listByCapability(capability: ManifestCapability): ProtocolMetadata[] {
    return this.list().filter((item) => item.capabilities.includes(capability));
  }

  /** 移除某插件的全部协议（插件卸载） */
  removeByPlugin(pluginId: string): number {
    let removed = 0;
    for (const [id, adapter] of this.adapters) {
      if (adapter.metadata.pluginId === pluginId) {
        this.adapters.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.log.log(`已卸载插件 ${pluginId} 的 ${removed} 个协议`);
    return removed;
  }

  /** 清单指纹：后台与缓存用它判断「协议集合是否变化」 */
  fingerprint(): string {
    return this.list()
      .map((item) => `${item.id}@${item.pluginId ?? 'builtin'}`)
      .join('|');
  }
}
