/**
 * 文件日志（落盘 + 轮转 + 脱敏）。
 *
 * 解决什么问题
 * ------------
 * 现有排错只有一条路径：`start.sh` 把后端 stdout 重定向到 `.run/backend.log`，
 * 但那有三个硬伤 ——
 *   1. 每次启动 `: > "$BACKEND_LOG"` **清空**，历史现场随重启消失；
 *   2. 只有经 start.sh 启动才有文件，直接 `node dist/main.js` 完全不落盘；
 *   3. 没有级别、没有轮转、没有保留期，异常现场无法按时间线回溯。
 * 本类把这三件事收到应用层：日志自己管自己的文件、自己的轮转、自己的保留期。
 *
 * 为什么不用 nestjs-pino / winston
 * -------------------------------
 * 两条路都要新增一到两棵依赖树（pino → sonic-boom/thread-stream/on-exit-leak-free/...），
 * 而本项目 node_modules 是手工直装的，嵌套副本无法由 npm 自动重现
 * （README「环境注意事项」第 4 条）。文件日志是纯基础设施，几十行 Node 内置能力
 * 即可覆盖需求，**零新增依赖**是这里最值钱的选择。
 *
 * 为什么用 appendFileSync 而不是 createWriteStream
 * -----------------------------------------------
 * stream 有缓冲，进程被 kill -9 时缓冲区内的日志直接丢 —— 而「进程崩了」恰恰是
 * 最需要日志的时刻。同步写是 O(条数) 的系统调用，本项目日志量级（启动若干行 +
 * 偶发 warn/error）远达不到成为瓶颈的程度。
 * 若将来把逐请求 access log 打开、日志量进入高频路径，再换异步流即可，
 * 届时只需替换本类的 writeLine 实现，对外接口不变。
 */
import { Injectable, Optional, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { startupWarnings, type LogLevel } from '../../config/env.validation';
import { currentRequestId } from '../request-context';

/** 级别 → 数值。数值越小越严重，与 Nest 的过滤语义一致 */
const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  verbose: 4,
};

/**
 * 敏感字段脱敏。
 *
 * 日志落盘后可能被 grep、被打包发走、被粘进工单，所以凭据必须在**写入前**打掉。
 * 刻意不做「长随机串一律打码」—— 那会把任务 id、md5 一起毁掉，反而丢失可查性。
 *
 * 两条规则的执行顺序不可交换：BEARER 必须在前。
 * 若先跑 kv 规则，`Authorization: Bearer eyJhbGciOi.xx` 会被它从 `=` 处截断成
 * `Authorization: ***`，`Bearer` 一消失，后面的 Bearer 规则再也匹配不到那个 token ——
 * 结果是**凭据明文原样留在日志里**。所以 kv 规则额外用负向前瞻拒绝 `Bearer `/`Basic ` 开头的值，
 * 双保险，避免将来有人调换顺序时重新引入泄漏。
 */
const BEARER_RE = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{8,})/gi;
// 捕获组顺序: 1=键 2=分隔符 3=开引号 4=值 5=闭引号 —— 改本正则时同步核对回调形参
// 值字符类必须排除引号, 否则贪婪匹配会把闭引号吞掉, 替换后 JSON 结构引号失配
const SECRET_KV_RE =
  /\b((?:[a-z0-9_-]*)(?:token|secret|password|passwd|api[_-]?key|authorization|credential)s?)("?\s*[:=]\s*)(["']?)(?!(?:Bearer|Basic)\s)([^\s"',;)}\]]{4,})(["']?)/gi;

export function maskSecrets(text: string): string {
  return text
    .replace(BEARER_RE, (_m, scheme: string) => `${scheme} ***`)
    // q = 值前的开引号, qc = 值后的闭引号; 两者各自补回, JSON 结构的引号才配得平
    .replace(SECRET_KV_RE, (_m, key: string, sep: string, q: string, _val: string, qc: string) => `${key}${sep}${q}***${qc}`);
}

/** 把 Nest 传进来的 (message, ...optionalParams) 拍平成可读文本 */
function formatMessage(message: unknown, params: unknown[]): string {
  let text: string;
  if (typeof message === 'string') {
    text = message;
  } else if (message instanceof Error) {
    text = message.stack ? `${message.message}\n${message.stack}` : message.message;
  } else if (message === undefined || message === null) {
    text = '';
  } else {
    try {
      text = JSON.stringify(message);
    } catch {
      text = String(message);
    }
  }

  // Nest 约定: 末位 string 参数是 context, 其余是堆栈/附加数据
  const rest = [...params];
  let context = '';
  if (rest.length > 0 && typeof rest[rest.length - 1] === 'string') {
    context = rest.pop() as string;
  }
  const extra = rest
    .map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : JSON.stringify(p)))
    .filter(Boolean)
    .join(' ');

  const body = [text, extra].filter(Boolean).join(' ');
  return context ? `[${context}] ${body}` : body;
}

/** 本地日期的 YYYY-MM-DD。用本地时区而非 UTC：运维看的是"今天几号的日志" */
function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class AppFileLogger implements LoggerService {
  /**
 * 级别门槛。**刻意不加 readonly** —— setLogLevels() 要在运行时改它，
 * 那是 LoggerService 可选接口的一部分（供宿主按环境动态调级别）。
 */
private threshold: number;

  /** 空串 = 日志目录不可用，已降级为纯控制台模式 */
  private readonly dir: string;
  private readonly retentionDays: number;
  private readonly maxBytes: number;
  private readonly maxFilesPerDay: number;
  private readonly mirrorToConsole: boolean;
  private readonly separateErrorFile: boolean;

  private currentDay = localDay();
  /** 当前 app 日志分片序号，0 表示未分片 */
  private shard = 0;
  private appBytes = 0;
  private errorBytes = 0;
  private lastCleanupDay = '';

  /** 目录不可用时只提示一次，避免 fs 故障时刷屏 */
  private degraded = false;

  /**
   * @Optional()：允许脱离 DI 容器单独 new（脚本、单元测试里造一个写临时目录的实例），
   * 此时全部配置回落到本文件内的默认值，行为与配置过一样。
   */
  constructor(@Optional() private readonly config?: ConfigService) {
    this.threshold = LEVEL_RANK[this.readLevel()];
    this.retentionDays = this.config?.get<number>('log.retentionDays') ?? 14;
    this.maxBytes = Math.max(1, this.config?.get<number>('log.maxFileMb') ?? 20) * 1024 * 1024;
    this.maxFilesPerDay = this.config?.get<number>('log.maxFilesPerDay') ?? 5;
    this.mirrorToConsole = this.config?.get<boolean>('log.console') ?? true;
    this.separateErrorFile = this.config?.get<boolean>('log.errorFile') ?? true;

    const rawDir = this.config?.get<string>('log.dir') ?? 'logs';
    const resolved = path.isAbsolute(rawDir) ? rawDir : path.join(process.cwd(), rawDir);
    this.dir = this.ensureDir(resolved);

    if (this.dir) {
      this.appBytes = this.sizeOf(this.appPath(0));
      this.errorBytes = this.sizeOf(this.errorPath(0));
      this.cleanupExpired();
      this.flushStartupWarnings();
    }
  }

  // ── LoggerService 接口 ────────────────────────────────────────────────

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    // fatal 一律按 error 落盘与镜像：它必然也要进 error 文件
    this.emit('error', `[FATAL] ${formatMessage(message, params)}`);
  }

  setLogLevels(levels: LogLevel[]): void {
    const ranks = levels.map((l) => LEVEL_RANK[l]).filter((n) => n !== undefined);
    if (ranks.length > 0) this.threshold = Math.min(...ranks);
  }

  // ── 公开只读属性 ─────────────────────────────────────────────────────

  /** 生效的日志目录；降级为纯控制台时为空串。供启动日志如实打印 */
  get logDir(): string {
    return this.dir;
  }

  /** 当前实例的级别门槛，调试配置问题时用 */
  get level(): LogLevel {
    return (Object.keys(LEVEL_RANK) as LogLevel[]).find((l) => LEVEL_RANK[l] === this.threshold) ?? 'log';
  }

  // ── 内部实现 ─────────────────────────────────────────────────────────

  /** 启动期校验收集到的告警此刻才有 logger 可用，补写一次 */
  private flushStartupWarnings(): void {
    while (startupWarnings.length > 0) {
      const w = startupWarnings.shift() as string;
      this.warn(w, 'ConfigModule');
    }
  }

  private readLevel(): LogLevel {
    const raw = String(this.config?.get<string>('log.level') ?? 'log').toLowerCase();
    return raw in LEVEL_RANK ? (raw as LogLevel) : 'log';
  }

  private emit(level: LogLevel, message: unknown, params: unknown[] = []): void {
    if (LEVEL_RANK[level] > this.threshold) return;

    const text = maskSecrets(formatMessage(message, params));
    /*
     * 请求上下文前缀: 有 AsyncLocalStorage 上下文时自动带上 rid,
     * 于是同一个请求里的所有日志行 (含各 service 打的) 都能被一条 grep 串起来。
     * 前缀加在脱敏之后 —— 它含唯一标识, 不该被"长随机串"类规则误伤。
     */
    const rid = currentRequestId();
    const body = rid ? `[rid=${rid}] ${text}` : text;
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${body}`;

    if (this.mirrorToConsole) {
      // 控制台镜像不能被 LOG_LEVEL 之外的逻辑吞掉：start.sh 的
      // .run/backend.log 是既有的第一现场排错路径，破坏它等于制造新坑。
      const lineOut = `[${level.toUpperCase()}] ${body}`;
      if (level === 'error') process.stderr.write(`${lineOut}\n`);
      else process.stdout.write(`${lineOut}\n`);
    }

    if (!this.dir) return;

    try {
      this.rollIfNeeded();
      this.append(this.appPath(this.shard), line, 'app');
      if (this.separateErrorFile && LEVEL_RANK[level] <= LEVEL_RANK.error) {
        this.append(this.errorPath(this.shard), line, 'error');
      }
    } catch (err) {
      this.degradeOnce(err);
    }
  }

  private appPath(shard: number): string {
    const base = path.join(this.dir, `app-${this.currentDay}.log`);
    return shard === 0 ? base : base.replace(/\.log$/, `.${shard}.log`);
  }

  private errorPath(shard: number): string {
    const base = path.join(this.dir, `app-${this.currentDay}.error.log`);
    return shard === 0 ? base : base.replace(/\.log$/, `.${shard}.error.log`);
  }

  /**
   * 轮转判定。每次写入前调用，两个维度：
   *   跨日 → 换文件名并把序号归零
   *   超体积 → 在当日分片间推进（到顶后复用最后一片，保证当天日志不丢）
   */
  private rollIfNeeded(): void {
    const today = localDay();
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.shard = 0;
      this.appBytes = this.sizeOf(this.appPath(0));
      this.errorBytes = this.sizeOf(this.errorPath(0));
      this.cleanupExpired();
      return;
    }

    const oversized = this.appBytes + this.errorBytes >= this.maxBytes;
    if (!oversized) return;

    if (this.shard + 1 < this.maxFilesPerDay) {
      this.shard += 1;
      this.appBytes = this.sizeOf(this.appPath(this.shard));
      this.errorBytes = this.sizeOf(this.errorPath(this.shard));
    }
    // 已到当日分片上限：继续写最后一片。单文件可涨到约 2×maxBytes，
    // 这是刻意的取舍 —— 宁可文件偏大，也不丢当天日志。
  }

  private append(file: string, line: string, counter: 'app' | 'error'): void {
    const payload = `${line}\n`;
    fs.appendFileSync(file, payload, 'utf8');
    const bytes = Buffer.byteLength(payload);
    if (counter === 'app') this.appBytes += bytes;
    else this.errorBytes += bytes;
  }

  private sizeOf(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  private ensureDir(dir: string): string {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (err) {
      process.stderr.write(
        `[AppFileLogger] 日志目录不可用，降级为仅控制台: ${dir} (${(err as Error).message})\n`,
      );
      this.degraded = true;
      return '';
    }
  }

  /**
   * 清理过期日志。只认自家命名 `app-YYYY-MM-DD[.N[.error]].log`，
   * 绝不递归删除、不动目录里其他文件 —— 日志目录可能被运维临时放了别的东西。
   */
  private cleanupExpired(): void {
    if (this.lastCleanupDay === this.currentDay) return;
    this.lastCleanupDay = this.currentDay;
    if (!this.dir) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);

    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return;
    }

    for (const name of entries) {
      const m = /^app-(\d{4}-\d{2}-\d{2})(?:\.\d+)?(?:\.error)?\.log$/.exec(name);
      if (!m) continue;
      const stamp = new Date(`${m[1]}T00:00:00`);
      if (!Number.isFinite(stamp.getTime()) || stamp >= cutoff) continue;
      try {
        fs.unlinkSync(path.join(this.dir, name));
      } catch {
        /* 单个文件删不掉不影响其余清理 */
      }
    }
  }

  /** 落盘失败时降级一次，之后静默 —— 日志故障绝不能反过来打挂业务 */
  private degradeOnce(err: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    process.stderr.write(
      `[AppFileLogger] 写日志失败，已降级为仅控制台: ${(err as Error).message}\n`,
    );
  }
}