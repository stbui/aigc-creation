/**
 * 优云智算通道真实链路验证（一次性脚本，非冒烟套件成员）。
 *
 * 目的：在不起后端服务的前提下，直接驱动 ModelVerseImageProvider 走完
 * 「读 DB 配置 → 构造请求 → 调真实 API → 拿到图片字节」全链路，
 * 证明接线正确（provider 选择、base64 参考图、size 换算、响应解析）。
 *
 * 与 smoke-gateway-channel.js 的区别：那个用「契约一致的本地桩」验证回落与
 * 路由逻辑，不需要真实凭据；本脚本打真实服务，会消耗额度，只在换通道时手跑。
 *
 * 用法：cd backend && npx ts-node -P tsconfig.json scripts/verify-modelverse-live.ts
 */
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { Jimp } from 'jimp';
import { setGatewayConfigOverrides, gatewayConfig } from '../src/providers/gateway.config';
import { ModelVerseImageProvider } from '../src/providers/modelverse-image.provider';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
import { PrismaClient } from '@prisma/client';

const OUT_DIR = join(process.cwd(), 'uploads', 'verify');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // Prisma 7 必须经driver adapter 连接 (与 PrismaService 同一条路径),
  // 裸 new PrismaClient() 拿不到 datasource url 会直接抛。
  const prisma = new PrismaClient({
    adapter: new NodeSQLiteDriverAdapterFactory({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
  });
  // 与 CapabilityRouterProvider.refreshConfig 同一条路径: 只注入 overridden 的行
  const rows = await prisma.modelChannelConfig.findMany({
    where: { overridden: true },
    select: { key: true, value: true },
  });
  setGatewayConfigOverrides(Object.fromEntries(rows.map((r) => [r.key, r.value])));

  const cfg = gatewayConfig();
  console.log('[cfg] provider =', cfg.provider);
  console.log('[cfg] baseUrl  =', cfg.baseUrl);
  console.log('[cfg] enabled  =', cfg.enabled);
  console.log('[cfg] hasToken =', Boolean(cfg.token), '(不打印明文)');

  if (!cfg.enabled || cfg.provider !== 'modelverse') {
    console.error('[FAIL] 通道未就绪: 需要 gateway.provider=modelverse 且 baseUrl/token 非空');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const provider = new ModelVerseImageProvider();
  const prompt = '电商广告质感：把主体放在未来感厨房场景中，清晨自然光，干净高级';

  /** 按 provider 回报的 mime 决定落盘扩展名, 不靠猜 */
  const extOf = (format: string) => (format === 'image/png' ? 'png' : 'jpg');

  // 场景一: 纯文生图 (free_create 的 inputs=0 路径)
  const t2i = await provider.generate('free_create', [], { prompt, ratio: '1:1', size: '1k' }, prompt);
  const dim = async (buf: Buffer) => {
    const im = await Jimp.read(buf);
    return `${im.bitmap.width}x${im.bitmap.height}`;
  };
  console.log(`[t2i] bytes=${t2i.buffer.length} format=${t2i.format} dims=${await dim(t2i.buffer)} model=${t2i.model}`);
  const t2iPath = join(OUT_DIR, `modelverse-t2i.${extOf(t2i.format)}`);
  await writeFile(t2iPath, t2i.buffer);

  // 场景二: 带参考图 (验证 base64 data URL 真被上游接受并参与构图)
  const ref = await Jimp.read(t2iPath);
  const refPath = join(OUT_DIR, '_ref-input.png');
  await writeFile(refPath, await ref.getBuffer('image/png'));
  const i2iPrompt = '保持主体不变，改成水彩插画风格';
  const i2i = await provider.generate(
    'free_create',
    [refPath],
    { prompt: i2iPrompt, ratio: '1:1', size: '1k' },
    i2iPrompt,
  );
  console.log(`[i2i] bytes=${i2i.buffer.length} format=${i2i.format} dims=${await dim(i2i.buffer)} model=${i2i.model}`);
  await writeFile(join(OUT_DIR, `modelverse-i2i.${extOf(i2i.format)}`), i2i.buffer);

  console.log('[OK] 产出已写入', OUT_DIR);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[FAIL]', e?.message ?? e);
  process.exitCode = 1;
});