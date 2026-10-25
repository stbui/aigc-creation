/**
 * 图像生成链路契约验证（2026-10-25，模型-only）。
 *
 * 本地图像生成算法已删除，本脚本不再验证“能否本地画图”，而是验证：
 *   1. 无模型线路 → NoModelChannelError（42204），不产出任何字节；
 *   2. 存量 route=local → 明确失败（42204），不静默改走远程；
 *   3. 遮罩遇到不支持 edits 的协议 → MaskUnsupportedError（42205）；
 *   4. 有线路但上游失败 → 普通生成异常（42201），不回落；
 *   5. 上游成功 → 只返回 source=gateway 的真实模型字节。
 *
 * 成功用例使用本机 HTTP 桩模拟 OpenAI 兼容响应，不调用外部模型、不伪造
 * 生产结果；桩返回的图片只用于验证协议解析与来源标记。
 */

import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { Jimp, JimpMime } from 'jimp';
import { CapabilityRouterProvider } from '../src/providers/capability-router.provider';
import {
  setGatewayConfigOverrides,
  invalidateGatewayConfigCache,
} from '../src/providers/gateway.config';
import { MaskUnsupportedError, NoModelChannelError } from '../src/providers/gateway.types';
import type { ChannelAttempt, ChannelDispatch } from '../src/providers/channel-scheduler';

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

type Mode = 'none' | 'success' | 'failure' | 'mask-unsupported';

let mode: Mode = 'none';
let server: Server | null = null;
let baseUrl = '';
let pngBase64 = '';

interface FakeLog {
  successes: number;
  failures: Array<{ reason: string; errorCode?: string; source: string }>;
}

function makeRouter(modeOf: () => Mode, logs: FakeLog) {
  const prisma = {
    modelChannelConfig: { findMany: async () => [] },
  } as never;
  const callLogger = {
    logSuccess: async () => {
      logs.successes += 1;
    },
    logFailure: async (row: { reason?: string; errorCode?: string; source: string }) => {
      logs.failures.push({ reason: row.reason ?? '', errorCode: row.errorCode, source: row.source });
    },
  } as never;
  const scheduler = {
    dispatch: async <T>(
      _modality: string,
      run: (channel: {
        id: string;
        name: string;
        protocol: string;
        baseUrl: string;
        token: string;
        model: string;
        priority: number;
        enabled: boolean;
      }) => Promise<T>,
    ): Promise<ChannelDispatch<T>> => {
      const current = modeOf();
      if (current === 'none') {
        return { ok: false, attempts: [], unavailableReason: '未配置任何模型通道' };
      }
      const channel = {
        id: 'smoke-channel',
        name: '本机模型桩',
        protocol: current === 'mask-unsupported' ? 'volcengine' : 'openai',
        baseUrl,
        token: 'smoke-token',
        model: 'smoke-image-model',
        priority: 0,
        enabled: true,
      };
      try {
        const value = await run(channel);
        return {
          ok: true,
          value,
          channel: { id: channel.id, name: channel.name, protocol: channel.protocol },
          attempts: [{
            channelId: channel.id,
            channelName: channel.name,
            protocol: channel.protocol,
            ok: true,
            latencyMs: 1,
            value,
          } as ChannelAttempt<T>],
        };
      } catch (e) {
        return {
          ok: false,
          attempts: [{
            channelId: channel.id,
            channelName: channel.name,
            protocol: channel.protocol,
            ok: false,
            latencyMs: 1,
            reason: (e as Error).message,
          }],
          unavailableReason: '全部通道均失败',
        };
      }
    },
  } as never;
  return new CapabilityRouterProvider(prisma, callLogger, scheduler);
}

async function expectError(fn: () => Promise<unknown>, ctor: Function, name: string) {
  try {
    await fn();
    ok(name, false, '未抛错');
  } catch (e) {
    ok(name, e instanceof ctor, (e as Error)?.name);
  }
}

async function main() {
  const image = new Jimp({ width: 64, height: 48, color: 0x336699ff });
  pngBase64 = (await image.getBuffer(JimpMime.png)).toString('base64');

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      if (mode === 'failure') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream exploded' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: pngBase64 }] }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const logs: FakeLog = { successes: 0, failures: [] };
  const router = makeRouter(() => mode, logs);

  console.log('\n【无模型通道 → 42204，不产出伪结果】');
  mode = 'none';
  await expectError(
    () => router.generate('expand', [], { occupy: 80 }),
    NoModelChannelError,
    '无线路时抛 NoModelChannelError',
  );
  ok('无线路失败记录为 42204', logs.failures.at(-1)?.errorCode === '42204', logs.failures.at(-1));

  console.log('\n【存量 route=local → 明确失败，不静默改走远程】');
  setGatewayConfigOverrides({ 'gateway.route.expand': 'local' });
  await expectError(
    () => router.generate('expand', [], { occupy: 80 }),
    NoModelChannelError,
    'route=local 抛 NoModelChannelError',
  );
  setGatewayConfigOverrides({});
  invalidateGatewayConfigCache();

  console.log('\n【遮罩 + 不支持 edits 的协议 → 42205】');
  mode = 'mask-unsupported';
  await expectError(
    () => router.generate('local_redraw', [], { prompt: '只改左侧' }, '/tmp/mask.png'),
    MaskUnsupportedError,
    '遮罩无编辑端点时抛 MaskUnsupportedError',
  );
  ok('遮罩不兼容记录为 42205', logs.failures.at(-1)?.errorCode === '42205', logs.failures.at(-1));

  console.log('\n【模型线路失败 → 42201，不回落】');
  mode = 'failure';
  let failureThrew = false;
  try {
    await router.generate('expand', [], { occupy: 80 });
  } catch (e) {
    failureThrew = !(e instanceof NoModelChannelError) && !(e instanceof MaskUnsupportedError);
  }
  ok('上游失败按普通生成异常抛出', failureThrew);
  ok('上游失败记录为 42201', logs.failures.at(-1)?.errorCode === '42201', logs.failures.at(-1));

  console.log('\n【模型成功 → source 只能是 gateway】');
  mode = 'success';
  const out = await router.generate('expand', [], { occupy: 80, ratio: '1:1', size: '1k' });
  ok('返回图片字节', out.kind === 'image' && out.buffer.length > 0, out.buffer.length);
  ok('来源标记为 gateway', out.source === 'gateway', out.source);
  const decoded = await Jimp.read(out.buffer);
  ok('返回字节可解码为图片', decoded.bitmap.width === 64 && decoded.bitmap.height === 48, {
    width: decoded.bitmap.width,
    height: decoded.bitmap.height,
  });
  ok('成功只写 gateway 调用记录', logs.successes === 1, logs.successes);

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.error(`\n失败 ${fails.length} 项:`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('图像生成链路验证通过：所有失败均显式失败，成功仅来自模型通道');
}

void main().finally(() => {
  server?.close();
});
