/**
 * 三环境 env 文件解析（development / test / production）。
 *
 * 为什么单独一个文件
 * ------------------
 * 有两处需要「按 NODE_ENV 选 env 文件」，但走的是完全不同的加载器：
 *   1. Nest 应用 —— `config.module.ts` 交给 @nestjs/config 的 `envFilePath`
 *   2. Prisma CLI —— `prisma.config.ts` 由 jiti 加载，**不经过 Nest**
 * 两边必须给出**逐字一致**的文件顺序，否则会出现「Nest 连的是 test.db、
 * prisma db push 打的是 dev.db」这种最难查的错位。故抽成唯一事实源。
 *
 * 分档规则（优先级从高到低）
 * -------------------------
 *   development: .env.development.local > .env.development > .env.local > .env
 *   test       : .env.test.local        > .env.test          （**不回落 .env**）
 *   production : .env.production.local  > .env.production    （**不回落 .env**）
 *
 * ⚠ test / production 刻意**不回落** `.env` 与 `.env.local`：
 * 开发库的 `DATABASE_URL=file:./dev.db` 写在共享 `.env` 里，一旦 test 继承它，
 * 测试就会往开发演示库里写脏数据；而 production 继承它等于把开发配置带上线。
 * 宁可「文件缺失 → 用代码默认值」，也不要「安静地连错库」。
 *
 * 零依赖：本项目依赖纪律是精确锁定 + 手工直装，不为一个 env 解析引入 dotenv
 * （@nestjs/config 内部已自带 dotenv，但 Prisma CLI 侧复用不到）。
 */

/** 三个受支持的环境名 */
export type AppEnv = 'development' | 'test' | 'production';

export const APP_ENVS: readonly AppEnv[] = ['development', 'test', 'production'];

/**
 * 把任意输入归一为受支持的环境名。
 * 非法值一律回落 development —— 与 env.validation.ts 里 NODE_ENV 的默认值一致。
 */
export function normalizeEnv(raw: string | undefined | null): AppEnv {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'test' || v === 'production' || v === 'development') return v;
  //常见的别名：staging / stage / prod / dev
  if (v === 'prod') return 'production';
  if (v === 'staging' || v === 'stage' || v === 'uat' || v === 'qa') return 'test';
  if (v === 'dev') return 'development';
  return 'development';
}

/**
 * 按环境给出 env 文件的加载顺序（**数组靠前优先**，@nestjs/config 的语义）。
 */
export function resolveEnvFiles(env: string | undefined | null): string[] {
  const e = normalizeEnv(env);
  const local = `.env.${e}.local`;
  const shared = `.env.${e}`;

  if (e === 'development') {
    // 开发态保留两个历史回落文件：多人协作时`.env` 是团队共享的，
    // `.env.local` 是个人私有覆盖（两者都已 gitignore 真实内容）。
    return [local, shared, '.env.local', '.env'];
  }
  return [local, shared];
}

/**
 * 解析单个 dotenv 文件的内容为键值对（纯文本 → 对象）。
 *
 * 支持的语法子集（够用且无歧义）：
 *   KEY=value            行首 # 为注释
 *   KEY="quoted value"    去除首尾同引号
 *   export KEY=value      去掉 export 前缀
 *   空行 / 纯注释行       忽略
 * 不支持行尾注释 —— 路径或密码里出现 `#` 时按字面量处理，比猜错安全。
 */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * 就地把env 文件内容写入 `target`（默认 process.env）。
 *
 * 优先级规则（两者必须分开看，混在一起就会出现「档位文件反被共享文件盖掉」）：
 *   1. **外部环境变量 > 任何文件**。容器 / CI 注入的 DATABASE_URL、JWT_SECRET
 *      是权威来源, 若被文件里的开发值悄悄盖掉,「配了没生效」会成为最难查的一类问题。
 *   2. **文件之间按 files 数组顺序, 靠前优先**。所以遍历时从低到高,
 *      并允许后面的（更高优先级的）文件覆盖前面已写入的值。
 *
 * 实现上必须**先快照**调用前就存在的键（外部注入），只保护这批；
 * 不能简单地全程不覆盖 —— 那会让 `.env`（最低优先级）赢过 `.env.test`。
 *
 * @returns 实际读取到的文件名（按优先级从高到低），供启动日志打印
 */
export function loadEnvFiles(
  env: string | undefined | null,
  cwd: string,
  target: NodeJS.ProcessEnv = process.env,
  files: readonly string[] = resolveEnvFiles(env),
): string[] {
  // 延迟 require：让纯 Node 脚本（无 fs mock）与测试可以只引类型
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  // 调用前就已存在的非空键 = 外部注入，全流程受保护
  const preexisting = new Set(
    Object.entries(target)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k]) => k),
  );

  const loaded: string[] = [];
  // 从低优先级到高优先级遍历：靠后写入的自然覆盖靠前的
  for (const file of [...files].reverse()) {
    const abs = path.resolve(cwd, file);
    if (!fs.existsSync(abs)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvText(fs.readFileSync(abs, 'utf8'));
    } catch {
      continue; // 读不动就当没有，绝不让一个坏文件阻断启动
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (!preexisting.has(k)) target[k] = v;
    }
    loaded.unshift(file); // 反向遍历后unshift → 最终顺序与 files 一致
  }
  return loaded;
}

/**
 * 上传目录的绝对路径。
 *
 * 三环境必须各写各的目录: test 环境复用开发目录时, 一条测试用例的
 * 「删除任务」就会连带删掉开发环境正在用的素材图, 且不留痕迹。
 * 兜底 'uploads' 与迁移前各处 `join(process.cwd(), 'uploads')` 逐字一致。
 */
export function resolveUploadsDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const raw = (env.UPLOAD_DIR ?? '').trim() || 'uploads';
  return require('path').resolve(cwd, raw) as string;
}

/**
 * 把 SQLite URL 解析成文件系统绝对路径。
 *
 * 只处理 `file:` 前缀（当前 provider 固定为 sqlite，无第二种形态）。
 * 其余前缀原样返回并交给上层报错 —— 静默拼一个错路径比报错更糟。
 *
 * 与 node-sqlite-adapter.ts 的 createClient 保持同一套语义：那边是
 * `url.replace(/^file:/, '')` 交给 node:sqlite 自行按 cwd 解析，
 * 这边需要绝对路径是因为备份服务要 `VACUUM INTO` 到备份目录。
 */
export function sqliteUrlToPath(url: string, cwd: string): string {
  const raw = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return require('path').resolve(cwd, raw) as string;
}