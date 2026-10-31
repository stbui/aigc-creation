/**
 * 内置插件清单库 —— 启动期扫描 `MODEL_PLUGIN_DIR/<id>/manifest.json`。
 *
 * 这批包随代码入库（110 个），是渠道模型可选的协议来源。这里只做三件事：
 * 读取、校验、索引；**不执行**包内任何代码，也不解压运行时产物。
 *
 * 失败策略：随代码发布的包解析失败属于发布阻断，直接启动失败并指名文件。
 * 用户上传的插件走另一条链路（安装时校验、失败只回滚那一个包），不要混用。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeManifest } from '../protocol/manifest';
import type { Manifest, ManifestCapability, ManifestProvider } from '../protocol/types';

export interface LoadedPlugin {
  manifest: Manifest;
  /** 包目录（绝对路径） */
  directory: string;
  /** 清单文件路径，便于错误定位 */
  manifestPath: string;
  /**
   * `builtin` = 随代码入库（`MODEL_PLUGIN_DIR`，不可卸载）；
   * `installed` = 后台上传（`MODEL_PLUGIN_INSTALL_DIR`，可卸载）。
   *
   * 两个目录分开是刻意的：上传的包若落在源码目录里，`git status` 会一直脏，
   * 且「删包」与「改代码」变成同一个动作。
   */
  origin: 'builtin' | 'installed';
}

@Injectable()
export class PluginManifestStore implements OnModuleInit {
  private readonly log = new Logger(PluginManifestStore.name);
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.scan();
  }

  /** 重新扫描目录（后台安装/卸载插件后调用） */
  scan(): void {
    const loaded = new Map<string, LoadedPlugin>();
    const builtinDir = this.builtinDirectory();
    if (existsSync(builtinDir)) {
      this.loadDirectory(loaded, builtinDir, 'builtin');
    } else {
      // 内置目录缺失只告警：用户可能只部署了上传的插件，不带源码目录
      this.log.warn(`插件目录不存在，跳过加载：${builtinDir}`);
    }
    const installDir = this.installDirectory();
    if (existsSync(installDir)) this.loadDirectory(loaded, installDir, 'installed');
    this.plugins.clear();
    for (const [id, plugin] of loaded) this.plugins.set(id, plugin);
    const installed = this.list().filter((plugin) => plugin.origin === 'installed').length;
    this.log.log(`已加载插件 ${this.plugins.size} 个（内置 ${this.plugins.size - installed} / 上传 ${installed}）`);
  }

  /** 内置插件目录（随代码入库，只读） */
  builtinDirectory(): string {
    return resolve(this.config.get<string>('model.pluginDir') ?? 'plugins');
  }

  /** 后台上传插件的安装目录 */
  installDirectory(): string {
    return resolve(this.config.get<string>('model.pluginInstallDir') ?? 'plugins-installed');
  }

  /**
   * 扫描单个目录。
   *
   * 两个目录的失败策略**不同**，这是有意的：
   *   · 内置包解析失败 = 发布阻断，直接抛错（带病启动会让渠道模型莫名其妙不可用）；
   *   · 上传包解析失败 = 用户数据损坏，记警告并跳过（一个坏包不能让整站起不来）。
   */
  private loadDirectory(target: Map<string, LoadedPlugin>, directory: string, origin: 'builtin' | 'installed'): void {
    for (const entry of readdirSync(directory).sort()) {
      // 点开头的是安装过程中的临时目录与系统垃圾文件，不是插件
      if (entry.startsWith('.')) continue;
      const pluginDir = join(directory, entry);
      if (!statSync(pluginDir).isDirectory()) continue;
      const manifestPath = join(pluginDir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      let manifest: Manifest;
      try {
        manifest = decodeManifest(readFileSync(manifestPath));
      } catch (error) {
        if (origin === 'builtin') {
          throw new Error(`内置插件清单无效（${manifestPath}）：${(error as Error).message}`);
        }
        this.log.warn(`上传插件清单无效，已跳过（${manifestPath}）：${(error as Error).message}`);
        continue;
      }
      /*
       * 上游在 plugin-packages 下为少数插件同时保留了「源目录」`src-<id>` 与
       * 「打包目录」`<id>`，两边的 manifest 内容一致、id 相同。上游按 zip 安装，
       * 从不按目录扫描，所以不会撞车；本仓按目录扫描，必须显式跳过源目录镜像，
       * 否则启动期会因「id 重复」直接失败。
       */
      if (origin === 'builtin' && entry.startsWith('src-') && manifest.metadata.id !== entry) continue;
      if (target.has(manifest.metadata.id)) {
        if (origin === 'builtin') {
          throw new Error(`内置插件 id 重复：${manifest.metadata.id}（${manifestPath}）`);
        }
        // 上传包与内置 id 相撞：安装时已拦，这里只可能是手工拷贝，内置优先
        this.log.warn(`上传插件与已有插件 id 重复，已忽略：${manifest.metadata.id}（${manifestPath}）`);
        continue;
      }
      target.set(manifest.metadata.id, { manifest, directory: pluginDir, manifestPath, origin });
    }
  }

  get(pluginId: string): LoadedPlugin | null {
    return this.plugins.get(String(pluginId ?? '').trim()) ?? null;
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()].sort((left, right) => left.manifest.metadata.id.localeCompare(right.manifest.metadata.id));
  }

  /** 全部 provider 贡献（协议注册的输入） */
  providers(): Array<{ pluginId: string; manifest: Manifest; provider: ManifestProvider; index: number }> {
    const result: Array<{ pluginId: string; manifest: Manifest; provider: ManifestProvider; index: number }> = [];
    for (const plugin of this.list()) {
      const providers = plugin.manifest.contributes?.providers ?? [];
      providers.forEach((provider, index) => {
        result.push({ pluginId: plugin.manifest.metadata.id, manifest: plugin.manifest, provider, index });
      });
    }
    return result;
  }

  /** 能力统计：后台插件页首屏用 */
  capabilityStats(): Record<ManifestCapability, number> {
    const stats: Record<ManifestCapability, number> = { text: 0, image: 0, video: 0, audio: 0 };
    for (const item of this.providers()) {
      for (const capability of item.provider.capabilities ?? []) {
        if (stats[capability] !== undefined) stats[capability] += 1;
      }
    }
    return stats;
  }

  /** 按清单字段统计后端类型，用于「当前环境不可用」的提示 */
  backendStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const plugin of this.list()) {
      const backend = String(plugin.manifest.runtime?.backend ?? 'declarative').trim() || 'declarative';
      stats[backend] = (stats[backend] ?? 0) + 1;
    }
    return stats;
  }
}
