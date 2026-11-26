/**
 * Redis（任务队列地基）验证。
 *
 * 为什么需要这一条
 * ----------------
 * Redis 是 BullMQ 的唯一运行期外部依赖：连接选项来自 `redisConnectionFromUrl(REDIS_URL)`，
 * 作业的去重、延迟、重试全部落在 Redis（`docs/environments.md` §任务队列）。此前仓库里
 * 没有任何断言碰过它 —— `task-queue.service.spec.ts` 用假 queue 证明「命令挂起时能超时」，
 * 但没证明真实 Redis 上这些语义成立，也没证明 URL 解析连的是对的库。
 *
 * 三段断言都打在**生产同一份代码**上，不另写一份队列逻辑自证：
 *   1. 纯逻辑：`redisConnectionFromUrl` 的 URL → ioredis 选项解析。不需要 Redis，
 *      永远执行。连错库比连不上更危险（作业投进别人的键空间），所以拒绝分支也钉住。
 *   2. 队列语义（需可达 Redis）：经 `TaskQueueService.enqueue()` / `scheduledTaskIds()`
 *      证明 jobId 去重、delay 进 delayed、指数退避重试、阻塞连接取作业、
 *      `removeOnComplete / removeOnFail` 真的不留残留作业。
 *   3. 故障注入（需可达 Redis）：把连接指向确定没人监听的端口，证明 `enqueue()` 在
 *      5 秒截止后**抛错返回**、`scheduledTaskIds()` 返回 null 并记录原因 ——
 *      这是 `QUEUE_COMMAND_TIMEOUT_MS` 存在的全部理由（ioredis 的离线队列在断连期间
 *      既不 resolve 也不 reject，会永久卡住调度器那一轮）。
 *
 * 隔离与清理
 * ----------
 * 作业投到独立队列 `verify-redis-probe`，**不碰 `generation-tasks`**：本机可能正有开发档
 * 后端在消费它。收尾只 obliterate 探针队列自身，并断言探针作业键不残留。
 * 探针队列名是固定的，因此**同一时刻只能跑一个实例**（两个并行实例会互抢对方的作业，
 * 表现成「重试次数不足 3 次」这种假失败）；与在跑的后端不冲突，因为两边队列不同名。
 * 无 Redis 时第 2/3 段记为 SKIP 而不是失败 —— 「Redis 没起」是环境事实，不是代码回归；
 * 拉起它由 `start.sh` 的 `ensure_redis()` 负责，CI 已提供 redis service。
 *
 * 用法：
 *   cd backend && npx ts-node -T scripts/verify-redis.ts
 *   # 打指定实例（例如经 SSH 隧道验证远端）：
 *   REDIS_URL=redis://127.0.0.1:6379/1 npx ts-node -T scripts/verify-redis.ts
 *   # 第 2/3 段约需 15 秒（退避 1s+2s 与两次 5s 截止各跑一轮）
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// 用 require 而非 import：TypeScript 会把 import 提升到文件最前，`NODE_ENV` 兜底与
// env 文件加载就会排在被依赖模块之后。与 verify-task-runtime.ts 保持同一写法。
const net = require('node:net');
const { loadEnvOnce } = require('./db-url');
loadEnvOnce();

const { Queue, Worker, Job } = require('bullmq');
const Redis = require('ioredis');
const { redisConnectionFromUrl } = require('../src/config/redis-connection');
const { TaskQueueService } = require('../src/model/tasks/task-queue.service');
const { GENERATION_QUEUE } = require('../src/model/tasks/task-queue.constants');

/** 本脚本专用队列名；与生产队列并存但互不消费 */
const PROBE_QUEUE = 'verify-redis-probe';
/** 与 task-queue.service.ts 的 QUEUE_COMMAND_TIMEOUT_MS 同值：断言打在同一个截止上 */
const COMMAND_TIMEOUT_MS = 5_000;
/**
 * 计时抖动容差。
 *
 * 截止由 `setTimeout(5000)` 实现，而回调用 `Date.now()` 求差：Node 的定时器轮次
 * 相对墙钟可提前约 1ms 触发，实测会拿到 4999ms。这里给 50ms 容差 ——
 * 断言语义不变（**不得早于截止返回**，也**不得远超截止**），只是不接受
 * 亚毫秒级的取整噪声。真正要防的是「永久 pending」和「提前误判」，两者都远大于 50ms。
 */
const TIMER_SLACK_MS = 50;

let pass = 0;
let fail = 0;
let skip = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

function skipped(name: string, reason: string): void {
  skip += 1;
  console.log(`  · SKIP ${name} — ${reason}`);
}

/** 只报事实，不计通过 / 失败：用于环境参数这类不该当门禁的读数 */
function info(msg: string): void {
  console.log(`  · INFO ${msg}`);
}

function section(title: string): void {
  console.log(`\n【${title}】`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 与 start.sh 的 ensure_redis 同一口径：1 秒内能建 TCP 连接才算可达 */
function tcpReachable(host: string, port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

/** 借一次 bind 到 0 号端口取一个确定没人监听的内核临时端口，用完立刻归还 */
function pickUnusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  // ── 1. 纯逻辑：连接串解析 ────────────────────────────────────────────────
  section('1. REDIS_URL → ioredis 连接选项（redisConnectionFromUrl）');
  {
    const base = redisConnectionFromUrl('redis://127.0.0.1:6379');
    check(
      '主机与端口',
      base.host === '127.0.0.1' && base.port === 6379,
      JSON.stringify(base),
    );
    check('不带库号时不下发 db（用服务端默认）', base.db === undefined, JSON.stringify(base));
    check('明文协议不加 TLS', base.tls === undefined);
    check(
      'BullMQ 要求的 maxRetriesPerRequest: null（Worker 阻塞连接的前提）',
      base.maxRetriesPerRequest === null,
      String(base.maxRetriesPerRequest),
    );

    check(
      '测试档 /1 解析成 db 1（与开发分库）',
      redisConnectionFromUrl('redis://127.0.0.1:6379/1').db === 1,
    );
    const db0 = redisConnectionFromUrl('redis://redis:6379/0');
    check(
      '生产编排 /0 解析成 db 0（0 不能被当空值丢掉）',
      db0.db === 0,
      JSON.stringify(db0),
    );
    const tls = redisConnectionFromUrl('rediss://host.example:6380/2');
    check(
      'rediss:// 启用 TLS 且端口库号照抄',
      !!tls.tls && tls.port === 6380 && tls.db === 2,
      JSON.stringify(tls),
    );
    // 口令里的 %40 必须还原成 @ 再交给 ioredis，否则认证直接失败（字面量，非真实凭证）
    const auth = redisConnectionFromUrl('redis://user:p%40ss@host.example:6379/3');
    check(
      '用户名与百分号编码口令还原成明文再交给 ioredis',
      auth.username === 'user' && auth.password === 'p@ss' && auth.db === 3,
      JSON.stringify({ username: auth.username, password: auth.password, db: auth.db }),
    );
    const bare = redisConnectionFromUrl('redis://host.example');
    check('省略端口回落 6379', bare.port === 6379, JSON.stringify(bare));
    check(
      '无凭证时不下发 username / password 空字段',
      !('username' in bare) && !('password' in bare),
      JSON.stringify(bare),
    );

    // 拒绝分支：静默连到别处比启动报错更难查
    let protoErr = '';
    try {
      redisConnectionFromUrl('http://127.0.0.1:6379');
    } catch (error) {
      protoErr = (error as Error).message;
    }
    check('非 redis / rediss 协议直接拒绝', /只支持/.test(protoErr), protoErr || '没有抛错');

    let badDbErr = '';
    try {
      redisConnectionFromUrl('redis://127.0.0.1:6379/abc');
    } catch (error) {
      badDbErr = (error as Error).message;
    }
    check('库号不是整数时拒绝', /数据库编号无效/.test(badDbErr), badDbErr || '没有抛错');

    let negErr = '';
    try {
      redisConnectionFromUrl('redis://127.0.0.1:6379/-1');
    } catch (error) {
      negErr = (error as Error).message;
    }
    check('负库号拒绝', /数据库编号无效/.test(negErr), negErr || '没有抛错');
  }

  // ── 2 / 3. 需要真实 Redis ────────────────────────────────────────────────
  const redisUrl = (process.env.REDIS_URL || '').trim() || 'redis://127.0.0.1:6379';
  const target = new URL(redisUrl);
  const reachable = await tcpReachable(target.hostname, Number(target.port || 6379));

  if (!reachable) {
    const why = `${redisUrl} 不可达（start.sh 的 ensure_redis 负责拉起）`;
    section('2. 队列语义（BullMQ × 真实 Redis）');
    skipped('作业去重 / 延迟 / 重试 / 阻塞取作业', why);
    section('3. Redis 不可达时的截止行为');
    skipped('enqueue 与 scheduledTaskIds 的 5 秒截止', why);
    return;
  }

  const connection = redisConnectionFromUrl(redisUrl);
  const queue = new Queue(PROBE_QUEUE, { connection });
  await queue.waitUntilReady();
  // 只做观测与键空间核对的命令客户端：有限重试，避免它自己把脚本挂住
  const raw = new Redis({ ...connection, maxRetriesPerRequest: 3, connectTimeout: 3_000 });

  section('2. 队列语义（BullMQ × 真实 Redis，经生产 TaskQueueService）');
  {
    const serverInfo = await raw.info('server');
    const version = /redis_version:([^\r\n]+)/.exec(serverInfo)?.[1] ?? '?';
    const mode = /redis_mode:([^\r\n]+)/.exec(serverInfo)?.[1] ?? '?';
    info(`服务端 redis ${version} / ${mode} ← ${redisUrl}`);

    // 解析对了 URL 还得真的连到那个库：拿服务端口径回读，而不是只看选项
    const clientInfo = await raw.client('info');
    const expectDb = connection.db ?? 0;
    const actualDb = Number(/(?:^|\s)db=(\d+)/.exec(String(clientInfo))?.[1]);
    check(
      `实际落在 REDIS_URL 指定的 db ${expectDb}`,
      actualDb === expectDb,
      `服务端报 db=${actualDb}`,
    );

    const persistence = await raw.info('persistence');
    const memory = await raw.info('memory');
    const appendonly = /aof_enabled:(\d)/.exec(persistence)?.[1] ?? '?';
    const maxmemory = /maxmemory:([^\r\n]+)/.exec(memory)?.[1] ?? '?';
    const policy = (await raw.config('get', 'maxmemory-policy'))?.[1] ?? 'noeviction';
    // 队列数据丢失由启动对账补投（docs/environments.md），所以只报读数不设门禁；
    // 但 noeviction + 无上限会一路涨到 OOM，宿主机直跑时要看得见。
    info(`aof_enabled=${appendonly} maxmemory=${maxmemory} policy=${policy}`);
    if (String(maxmemory) === '0' && String(policy) === 'noeviction') {
      info('未设 maxmemory 且 noeviction：内存无界增长，作业堆积时不会被回收');
    }

    // 开发档后端若已投过作业，meta 里的 bullmq 版本必须与本仓库依赖一致，
    // 否则等于两套 BullMQ 在同一个键空间上交替写。
    const liveVersion = await raw.hget(`bull:${GENERATION_QUEUE}:meta`, 'version');
    const localVersion = require('bullmq/package.json').version;
    if (liveVersion) {
      check(
        `生产队列 ${GENERATION_QUEUE} 的 bullmq 版本与依赖一致`,
        liveVersion === `bullmq:${localVersion}`,
        `队列侧 ${liveVersion} / 本地 bullmq@${localVersion}`,
      );
    } else {
      info(`队列 ${GENERATION_QUEUE} 尚无作业（未投过），版本核对跳过`);
    }

    const stamp = Date.now();
    const taskA = `verify-a-${stamp}`;
    const taskB = `verify-delayed-${stamp}`;
    const taskC = `verify-failing-${stamp}`;
    const service = new TaskQueueService(queue);

    await service.enqueue(taskA);
    const waiting = await queue.getRanges(['waiting'], 0, 999);
    check(
      'enqueue() 把 taskId 投成作业（jobId = taskId）',
      waiting.length === 1 && waiting[0] === taskA,
      JSON.stringify(waiting),
    );

    const stored = await Job.fromId(queue, taskA);
    check(
      '作业数据带 taskId',
      stored?.data?.taskId === taskA,
      JSON.stringify(stored?.data),
    );
    check(
      '作业选项照抄生产声明（重试 3 次 + 指数退避 1s + 完成即删）',
      stored?.opts?.attempts === 3 &&
        stored?.opts?.backoff?.type === 'exponential' &&
        stored?.opts?.backoff?.delay === 1_000 &&
        stored?.opts?.removeOnComplete === true &&
        stored?.opts?.removeOnFail === true,
      JSON.stringify(stored?.opts),
    );

    // 幂等：恢复对账每轮都会重投同一批 taskId，重复提交不能跑两遍
    await service.enqueue(taskA);
    await service.enqueue(taskA);
    const afterDup = await queue.getRanges(['waiting'], 0, 999);
    const jobKeys = await raw.keys(`bull:${PROBE_QUEUE}:${taskA}`);
    check(
      '同一 taskId 连投 3 次只留一份作业',
      afterDup.length === 1 && jobKeys.length === 1,
      `waiting=${JSON.stringify(afterDup)} 作业键=${jobKeys.length} 个`,
    );

    await service.enqueue(taskB, 60_000);
    const delayed = await queue.getRanges(['delayed'], 0, 999);
    check(
      '延后派发（切线退避 / 补投）用的就是 delayed 态',
      delayed.includes(taskB),
      JSON.stringify(delayed),
    );

    await service.enqueue(taskC);
    const ids = await service.scheduledTaskIds();
    check(
      'scheduledTaskIds() 读全仍在执行的 taskId（对账据此判断是否补投）',
      ids !== null && [taskA, taskB, taskC].every((id) => ids.has(id)),
      JSON.stringify(ids ? [...ids] : ids),
    );
    check(
      '读取成功时清空 lastReadFailure',
      service.lastReadFailure === null,
      String(service.lastReadFailure),
    );

    // Worker 走 BLMOVE 阻塞取作业：这一步同时证明服务端允许阻塞连接、
    // 且 delayed 作业不会被提前派发
    const handled: string[] = [];
    const failStamps: number[] = [];
    const worker = new Worker(
      PROBE_QUEUE,
      async (job: { data: { taskId: string } }) => {
        const taskId = job.data.taskId;
        handled.push(taskId);
        if (taskId === taskC) {
          failStamps.push(Date.now());
          throw new Error('模拟上游线路不可用');
        }
        return { ok: true };
      },
      { connection, concurrency: 2 },
    );
    await worker.waitUntilReady();

    const deadline = Date.now() + 15_000;
    while (failStamps.length < 3 && Date.now() < deadline) await sleep(200);
    // taskA 完成后被 removeOnComplete 删除、taskC 重试耗尽后被 removeOnFail 删除。
    // 删除是异步收尾，等到两个键都消失或超时为止 —— 超时不算失败，交给下面的断言如实报错。
    const gone = (id: string) => raw.exists(`bull:${PROBE_QUEUE}:${id}`).then((n: number) => n === 0);
    const cleanDeadline = Date.now() + 6_000;
    while (Date.now() < cleanDeadline && (!(await gone(taskA)) || !(await gone(taskC)))) await sleep(200);

    check('Worker 经阻塞连接取到 wait 中的作业并执行', handled.includes(taskA), JSON.stringify(handled));
    check('delayed 作业不会被提前派发', !handled.includes(taskB), JSON.stringify(handled));
    check(
      `按生产 attempts=3 重试失败作业`,
      failStamps.length === 3,
      `实际执行 ${failStamps.length} 次`,
    );
    const gaps = failStamps.slice(1).map((t, i) => t - failStamps[i]);
    check(
      '退避是指数（1s → 2s），不是固定间隔',
      gaps.length === 2 && gaps[0] >= 900 && gaps[0] <= 3_000 && gaps[1] >= 1_800 && gaps[1] <= 4_500,
      `实测间隔 ${JSON.stringify(gaps)}ms`,
    );
    check(
      'removeOnComplete 生效：完成的作业不留在队列里堆积',
      (await raw.exists(`bull:${PROBE_QUEUE}:${taskA}`)) === 0,
    );
    check(
      'removeOnFail 生效：重试耗尽后也不留残留',
      (await raw.exists(`bull:${PROBE_QUEUE}:${taskC}`)) === 0,
    );

    await worker.close();
    await queue.obliterate({ force: true });
    const probeLeft = await raw.keys(`bull:${PROBE_QUEUE}:*`);
    check('探针队列已清理（只动 verify-redis-probe，不碰生产队列）', probeLeft.length === 0, JSON.stringify(probeLeft));
    info(`本环境 db${expectDb} 当前键总数 ${await raw.dbsize()}`);
  }

  // ── 3. 故障注入 ──────────────────────────────────────────────────────────
  section('3. Redis 不可达时不挂调用方（QUEUE_COMMAND_TIMEOUT_MS 的存在理由）');
  {
    const deadPort = await pickUnusedPort();
    check(`故障注入端口 ${deadPort} 确实无人监听`, (await tcpReachable('127.0.0.1', deadPort)) === false);

    // 同一条生产解析路径，只是换成不可达地址：挂起风险来自连接选项，不是 URL 写错
    const deadQueue = new Queue(PROBE_QUEUE, {
      connection: redisConnectionFromUrl(`redis://127.0.0.1:${deadPort}`),
    });
    // 断连期间 ioredis 按退避持续重连并抛 error 事件。不监听的话每隔 200ms 就往控制台
    // 刷一段 ECONNREFUSED 栈，把真正的失败信号埋掉。这里只吞噪声 —— 断言打在
    // 「命令有没有在截止内返回」上，与连接层报什么错无关。
    deadQueue.on('error', () => undefined);
    const deadService = new TaskQueueService(deadQueue);

    const t1 = Date.now();
    let enqueueErr = '';
    try {
      await deadService.enqueue('never-lands');
    } catch (error) {
      enqueueErr = (error as Error).message;
    }
    const waited1 = Date.now() - t1;
    check(
      'enqueue() 在截止后抛错返回，而不是永久 pending',
      /未返回/.test(enqueueErr),
      enqueueErr || '没有抛错 —— 调用方会被 ioredis 离线队列永久挂住',
    );
    check(
      `等待时长贴着 ${COMMAND_TIMEOUT_MS}ms 截止`,
      waited1 >= COMMAND_TIMEOUT_MS - TIMER_SLACK_MS && waited1 < COMMAND_TIMEOUT_MS + 3_000,
      `实际 ${waited1}ms`,
    );

    const t2 = Date.now();
    const ids = await deadService.scheduledTaskIds();
    const waited2 = Date.now() - t2;
    check(
      '读不到队列时返回 null（调用方本轮跳过，不对整库补投）',
      ids === null,
      JSON.stringify(ids),
    );
    check(
      '原因记进 lastReadFailure，供对账报成一次失败而不是静默成功',
      new RegExp(`超过 ${COMMAND_TIMEOUT_MS}ms 未返回`).test(String(deadService.lastReadFailure)),
      String(deadService.lastReadFailure),
    );
    check(
      '读取同样受截止约束（不会把调度器那一轮挂死）',
      waited2 >= COMMAND_TIMEOUT_MS - TIMER_SLACK_MS && waited2 < COMMAND_TIMEOUT_MS + 3_000,
      `实际 ${waited2}ms`,
    );
  }

  // 探针连接正常，可以体面关闭。deadQueue 故意不关：它的连接同样带着
  // maxRetriesPerRequest: null，close() 会等在途命令 settle —— 那正是上面刚证明过的
  // 挂起行为，用它来收尾就等于自己把自己挂住。进程退出交给末尾的 process.exit。
  await queue.close().catch(() => undefined);
  await raw.quit().catch(() => undefined);
}

main()
  .catch((error) => {
    console.error(`\n脚本异常退出：${(error as Error).stack || error}`);
    fail += 1;
  })
  .finally(() => {
    console.log(`\n${'='.repeat(56)}`);
    console.log(`  通过 ${pass} 项，失败 ${fail} 项，跳过 ${skip} 项`);
    console.log('='.repeat(56));
    process.exit(fail > 0 ? 1 : 0);
  });
