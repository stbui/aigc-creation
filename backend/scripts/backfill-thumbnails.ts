/**
 * 存量素材缩略图回填。
 *
 * ## 为什么需要
 *
 * 缩略图现在改为**写入侧预热**（上传 / AI 产出落库时就算好，见
 * `src/assets/thumb-render.ts`），但改造之前入库的素材没有缓存，第一次翻素材库
 * 仍会退回到「按需解码」——一张 9MP 手机照片约 1.0–1.3s，一屏 20 多张就是几十秒，
 * 期间 Node 主线程被同步解码占满，接口一起卡。这个脚本把这些存量一次性补齐。
 *
 * ## 用法
 *
 *   npm run backfill:thumbs                 # 使用 UPLOAD_DIR（默认 uploads）
 *   npm run backfill:thumbs -- --dir=/data/uploads
 *   npm run backfill:thumbs -- --force      # 已缓存也重算
 *
 * 纯文件系统遍历，不连数据库：缓存只与「磁盘上的原图 + 尺寸变体」有关。
 * 已被删除的素材留下的孤儿文件即使被回填也无害（不会被任何页面引用）。
 */
import { promises as fsp } from 'fs';
import { join, relative, resolve, sep } from 'path';
import {
  WARM_THUMB_SPECS,
  readThumbCache,
  renderThumbsFromBuffer,
  saveThumbCache,
  thumbCacheFile,
} from '../src/assets/thumb-render';

/** 与中间件 / 前端请求一致：同时解码的图片数（内存峰值约束，不是吞吐） */
const CONCURRENCY = 2;

interface Job {
  key: string;
  file: string;
}

function parseArgs(argv: string[]): { dir: string; force: boolean } {
  const dirArg = argv.find((arg) => arg.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice('--dir='.length) : process.env.UPLOAD_DIR ?? 'uploads';
  return { dir: resolve(dir), force: argv.includes('--force') };
}

async function collect(dir: string): Promise<Job[]> {
  const jobs: Job[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        // .thumbs 是缓存自身，不能回填（否则递归生成）
        if (entry.name === '.thumbs') continue;
        await walk(full);
        continue;
      }
      // 视频等非图片交给渲染层判断（detectImageMime 不认就直接跳过）
      jobs.push({ key: relative(dir, full).split(sep).join('/'), file: full });
    }
  }
  await walk(dir);
  return jobs;
}

async function main(): Promise<void> {
  const { dir, force } = parseArgs(process.argv.slice(2));
  const exists = await fsp
    .stat(dir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  if (!exists) {
    console.error(`上传目录不存在: ${dir}`);
    process.exitCode = 1;
    return;
  }

  const jobs = await collect(dir);
  // 与中间件同一开关：关闭时运行时不会消费缩略图，缓存文件永远读不到
  const enabled = ['true', '1'].includes(
    (process.env.ASSET_THUMBNAIL_ENABLED ?? '').trim().toLowerCase(),
  );
  if (!enabled) {
    console.warn(
      '提示：ASSET_THUMBNAIL_ENABLED 当前不是 true —— 缩略图中间件处于关闭态，' +
        '回填出的缓存不会被请求。回填前请先在后端环境变量里打开该开关。',
    );
  }
  console.log(`待检查素材 ${jobs.length} 个 · 目录 ${dir} · 变体 ${WARM_THUMB_SPECS.map((s) => `${s.w}x${s.h ?? 'auto'}`).join(' / ')}`);

  const started = Date.now();
  let warm = 0;
  let cached = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        if (!force) {
          const allCached = (
            await Promise.all(
              WARM_THUMB_SPECS.map((spec) => readThumbCache(thumbCacheFile(dir, job.key, spec))),
            )
          ).every(Boolean);
          if (allCached) {
            cached += 1;
            continue;
          }
        }
        const source = await fsp.readFile(job.file);
        const rendered = await renderThumbsFromBuffer(source, WARM_THUMB_SPECS);
        if (rendered.length === 0) {
          skipped += 1; // 不是可解码图片（视频 / WebP / 超像素上限）
          continue;
        }
        for (const { spec, body } of rendered) {
          await saveThumbCache(thumbCacheFile(dir, job.key, spec), body);
        }
        warm += 1;
      } catch (error) {
        failed += 1;
        console.warn(`  失败 ${job.key}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        const done = warm + cached + skipped + failed;
        if (done % 20 === 0) console.log(`  进度 ${done}/${jobs.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(
    `完成：新生成 ${warm} · 已缓存 ${cached} · 跳过 ${skipped} · 失败 ${failed} · 耗时 ${(
      (Date.now() - started) / 1000
    ).toFixed(1)}s`,
  );
}

void main();
