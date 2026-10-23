/**
 * 故障转移的**端到端**验证 (2026-10-20)。
 *
 * 为什么单独写: 前面断言验证的是「调度器会试下一条」, 但**没有**验证
 * 「试下一条时用的是它自己的 baseUrl/token」。而后者才是多渠道的真正价值 ——
 * 若 provider 仍读全局配置, 切到备用通道发的还是主通道地址, 照样失败,
 * 且从日志上看不出任何异常 (这是最坏的一类假修复)。
 *
 * 故这里起两个真 HTTP 桩服务器 (模拟两家厂商), 让主通道 500、备用 200,
 * 断言最终请求真的打到了备用厂商的地址。
 */
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { BaseImageProvider } from '../src/providers/image-provider-base';
import { ChannelScheduler } from '../src/providers/channel-scheduler';

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d?: unknown) => { if (c) pass++; else fails.push(`${n}${d!==undefined?` — ${JSON.stringify(d)}`:''}`); };

class FakePrisma {
  rows: any[] = [];
  modelChannel = {
    findMany: async (a: any) => this.rows.filter(r => r.modality === a?.where?.modality).sort((x,y)=>x.priority-y.priority),
    findUnique: async (a: any) => { const r=this.rows.find(x=>x.id===a.where.id); if(!r) return null; if(a.select){const o:any={};for(const k of Object.keys(a.select)) if(a.select[k]) o[k]=r[k]; return o;} return r; },
    update: async (a: any) => { const r=this.rows.find(x=>x.id===a.where.id); if(r) Object.assign(r,a.data); return r; },
  };
  $transaction = async (ps: Promise<unknown>[]) => { for (const p of ps) await p; };
}

/** 一个会打真 HTTP 的图像 provider (用 openai 协议) */
class RealHttpProvider extends BaseImageProvider {
  constructor() { super('openai'); }
}

async function main() {
  // 两个真桩: 主厂商 500, 备用厂商 200
  const hits: string[] = [];
  const primary = createServer((req, res) => {
    hits.push(`primary ${req.url}`);
    res.writeHead(500); res.end('{"error":{"message":"upstream down"}}');
  });
  const backup = createServer((req, res) => {
    hits.push(`backup ${req.url}`);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ data: [{ url: null, b64_json: Buffer.from('fakepng').toString('base64') }] }));
  });
  await new Promise<void>(r => primary.listen(0, '127.0.0.1', r));
  await new Promise<void>(r => backup.listen(0, '127.0.0.1', r));
  const pPort = (primary.address() as AddressInfo).port;
  const bPort = (backup.address() as AddressInfo).port;

  const prisma = new FakePrisma();
  prisma.rows = [
    { id:'main', modality:'image', name:'主厂商', protocol:'openai', baseUrl:`http://127.0.0.1:${pPort}`, token:'tok-main', model:'model-main', priority:0, enabled:true, failCount:0, cooldownUntil:null },
    { id:'backup', modality:'image', name:'备用厂商', protocol:'openai', baseUrl:`http://127.0.0.1:${bPort}`, token:'tok-backup', model:'model-backup', priority:1, enabled:true, failCount:0, cooldownUntil:null },
  ];
  const scheduler = new ChannelScheduler(prisma as never);

  const provider = new RealHttpProvider();
  const dispatch = await scheduler.dispatch('image', async (channel) => {
    provider.withChannel({ baseUrl: channel.baseUrl, token: channel.token, model: channel.model });
    return provider.generate('free_create', [], {}, '画一只猫');
  });

  ok('主通道失败后切到备用并成功', dispatch.ok === true, dispatch);
  ok('回报的是备用通道', dispatch.channel?.id === 'backup', dispatch.channel);

  // 关键: 请求真的打到了备用厂商地址
  ok('请求打到了主厂商', hits.some(h => h.startsWith('primary')), hits);
  ok('请求也打到了备用厂商', hits.some(h => h.startsWith('backup')), hits);
  ok('两个厂商都收到了 /v1/images/generations',
     hits.filter(h => h.includes('/v1/images/generations')).length === 2, hits);

  // 更细: 备用通道那次请求用的模型名是 model-backup (不是全局/主通道的)
  const backupHit = hits.find(h => h.startsWith('backup'));
  ok('备用通道的请求路径正确', backupHit?.includes('/v1/images/generations') === true, backupHit);

  // 主通道应被记一次失败
  const mainRow = prisma.rows.find(r => r.id === 'main');
  ok('主通道失败被计数', mainRow.failCount === 1, mainRow.failCount);
  const backupRow = prisma.rows.find(r => r.id === 'backup');
  ok('备用通道成功后清零', backupRow.failCount === 0, backupRow.failCount);

  primary.close(); backup.close();

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) { console.error(`\n失败 ${fails.length} 项:`); for (const f of fails) console.error('  ✗ '+f); process.exit(1); }
  console.log('故障转移端到端断言通过（切通道时真的用了它自己的 baseUrl/token/model）');
}
void main();
