/**
 * 校验内置插件清单（P0 验收脚本）。
 *
 * 扫描 `plugins/<id>/manifest.json`，用运行时同一套 `decodeManifest` 解析并校验，
 * 输出：包数、provider 数、能力分布、后端类型分布，以及每条失败的具体原因。
 *
 * 用法：
 *   cd backend && npx ts-node -T scripts/verify-plugin-manifests.ts
 *   cd backend && npx ts-node -T scripts/verify-plugin-manifests.ts --dir ../some-dir
 *
 * 退出码：全部通过 0，存在失败 1。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeManifest } from '../src/model/protocol/manifest';
import type { ManifestCapability } from '../src/model/protocol/types';

interface Result {
  directory: string;
  pluginId?: string;
  providers: number;
  backend: string;
  capabilities: ManifestCapability[];
  error?: string;
}

function main(): void {
  const dirIndex = process.argv.indexOf('--dir');
  const root = resolve(dirIndex >= 0 ? process.argv[dirIndex + 1] : 'plugins');
  if (!existsSync(root)) {
    console.error(`插件目录不存在：${root}`);
    process.exit(1);
  }

  const results: Result[] = [];
  // 与运行时 PluginManifestStore 同一口径：`src-<id>` 是上游并列保留的源目录镜像，
  // id 与打包目录相同，计入统计会让「脚本报 110、运行时加载 107」对不上账。
  const mirrors: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const pluginDir = join(root, entry);
    if (!statSync(pluginDir).isDirectory()) continue;
    const manifestPath = join(pluginDir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = decodeManifest(readFileSync(manifestPath));
      if (entry.startsWith('src-') && manifest.metadata.id !== entry) {
        mirrors.push(entry);
        continue;
      }
      const providers = manifest.contributes?.providers ?? [];
      results.push({
        directory: entry,
        pluginId: manifest.metadata.id,
        providers: providers.length,
        backend: String(manifest.runtime?.backend ?? '').trim() || 'declarative',
        capabilities: [...new Set(providers.flatMap((provider) => provider.capabilities ?? []))],
      });
    } catch (error) {
      results.push({
        directory: entry,
        providers: 0,
        backend: '-',
        capabilities: [],
        error: (error as Error).message,
      });
    }
  }

  const failed = results.filter((item) => item.error);
  const capabilityStats: Record<string, number> = {};
  const backendStats: Record<string, number> = {};
  let providerCount = 0;
  for (const item of results) {
    if (item.error) continue;
    providerCount += item.providers;
    backendStats[item.backend] = (backendStats[item.backend] ?? 0) + 1;
    for (const capability of item.capabilities) {
      capabilityStats[capability] = (capabilityStats[capability] ?? 0) + 1;
    }
  }

  const capabilitySummary = Object.entries(capabilityStats)
    .map(([key, value]) => key + '=' + value)
    .join(' ');
  const backendSummary = Object.entries(backendStats)
    .map(([key, value]) => key + '=' + value)
    .join(' ');

  console.log(`插件包：${results.length} 个（失败 ${failed.length}；另有源目录镜像 ${mirrors.length} 个已跳过）`);
  console.log(`provider 贡献：${providerCount} 个`);
  console.log(`能力分布：${capabilitySummary}`);
  console.log(`后端分布：${backendSummary}`);
  if (failed.length > 0) {
    console.log('\n失败明细：');
    for (const item of failed) {
      console.log(`- ${item.directory}: ${item.error}`);
    }
    process.exit(1);
  }
}

main();
