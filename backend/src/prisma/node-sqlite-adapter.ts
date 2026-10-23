/**
 * node-sqlite-adapter.ts
 *
 * Prisma 7 driver adapter, 基于 Node.js 内置 `node:sqlite` (Node >= 22.5)。
 *
 * 为什么不用官方 @prisma/adapter-better-sqlite3:
 *   better-sqlite3 需要 node-gyp 编译或 prebuild-install 从 GitHub Releases 拉二进制,
 *   本机 npm 走 broker 代理无法完成安装脚本, 导致缺 build/Release/better_sqlite3.node。
 *   libsql 同理需要 @libsql/<platform> 原生包。
 *   node:sqlite 是 Node 运行时内置模块, 零安装零编译, API 与 better-sqlite3 高度一致
 *   (prepare/bind/all/run/exec/close), 故按官方 adapter 的同构接口实现。
 *
 * 类型转换与错误映射直接复用 @prisma/driver-adapter-utils 与官方实现一致的逻辑。
 */
import {
  ColumnType,
  ColumnTypeEnum,
  Debug,
  DriverAdapterError,
  IsolationLevel,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const debug = Debug('prisma:driver-adapter:node-sqlite');

// ============ 类型推断 / 值映射 (与官方 better-sqlite3 adapter 一致) ============

function mapDeclType(declType: string | null): ColumnType | null {
  if (declType === null) return null;
  switch (declType.toUpperCase()) {
    case '':
      return null;
    case 'DECIMAL':
      return ColumnTypeEnum.Numeric;
    case 'FLOAT':
      return ColumnTypeEnum.Float;
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
    case 'NUMERIC':
    case 'REAL':
      return ColumnTypeEnum.Double;
    case 'TINYINT':
    case 'SMALLINT':
    case 'MEDIUMINT':
    case 'INT':
    case 'INTEGER':
    case 'SERIAL':
    case 'INT2':
      return ColumnTypeEnum.Int32;
    case 'BIGINT':
    case 'UNSIGNED BIG INT':
    case 'INT8':
      return ColumnTypeEnum.Int64;
    case 'DATETIME':
    case 'TIMESTAMP':
      return ColumnTypeEnum.DateTime;
    case 'TIME':
      return ColumnTypeEnum.Time;
    case 'DATE':
      return ColumnTypeEnum.Date;
    case 'TEXT':
    case 'CLOB':
    case 'CHARACTER':
    case 'VARCHAR':
    case 'VARYING CHARACTER':
    case 'NCHAR':
    case 'NATIVE CHARACTER':
    case 'NVARCHAR':
      return ColumnTypeEnum.Text;
    case 'BLOB':
      return ColumnTypeEnum.Bytes;
    case 'BOOLEAN':
      return ColumnTypeEnum.Boolean;
    case 'JSONB':
      return ColumnTypeEnum.Json;
    default:
      debug('unknown decltype:', declType);
      return null;
  }
}

function inferColumnType(value: unknown): ColumnType {
  switch (typeof value) {
    case 'string':
      return ColumnTypeEnum.Text;
    case 'bigint':
      return ColumnTypeEnum.Int64;
    case 'boolean':
      return ColumnTypeEnum.Boolean;
    case 'number':
      return ColumnTypeEnum.UnknownNumber;
    case 'object':
      if (value instanceof ArrayBuffer) return ColumnTypeEnum.Bytes;
      throw new UnexpectedTypeError(value);
    default:
      throw new UnexpectedTypeError(value);
  }
}

class UnexpectedTypeError extends Error {
  name = 'UnexpectedTypeError';
  constructor(value: unknown) {
    const type = typeof value;
    const repr = type === 'object' ? JSON.stringify(value) : String(value);
    super(`unexpected value of type ${type}: ${repr}`);
  }
}

function mapRow(row: unknown[], columnTypes: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < row.length; i++) {
    const value = row[i];
    if (
      typeof value === 'number' &&
      (columnTypes[i] === ColumnTypeEnum.Int32 ||
        columnTypes[i] === ColumnTypeEnum.Int64) &&
      !Number.isInteger(value)
    ) {
      result[i] = Math.trunc(value);
      continue;
    }
    if (
      ['number', 'bigint'].includes(typeof value) &&
      columnTypes[i] === ColumnTypeEnum.DateTime
    ) {
      result[i] = new Date(Number(value)).toISOString();
      continue;
    }
    if (typeof value === 'bigint') {
      const asNumber = Number(value);
      result[i] = Number.isSafeInteger(asNumber) ? asNumber : value.toString();
      continue;
    }
    result[i] = value;
  }
  return result;
}

function mapArg(arg: unknown, argType: { scalarType: string }, options?: { timestampFormat?: string }) {
  if (arg === null) return null;
  if (typeof arg === 'string' && argType.scalarType === 'int') return Number.parseInt(arg);
  if (typeof arg === 'string' && argType.scalarType === 'float') return Number.parseFloat(arg);
  if (typeof arg === 'string' && argType.scalarType === 'decimal') return Number.parseFloat(arg);
  if (typeof arg === 'string' && argType.scalarType === 'bigint') return BigInt(arg);
  if (typeof arg === 'boolean') return arg ? 1 : 0;
  if (typeof arg === 'string' && argType.scalarType === 'datetime') {
    arg = new Date(arg);
  }
  if (arg instanceof Date) {
    const format = options?.timestampFormat ?? 'iso8601';
    switch (format) {
      case 'unixepoch-ms':
        return arg.getTime();
      case 'iso8601':
        return arg.toISOString().replace('Z', '+00:00');
      default:
        throw new Error(`Unknown timestamp format: ${format}`);
    }
  }
  if (typeof arg === 'string' && argType.scalarType === 'bytes') {
    return Buffer.from(arg, 'base64');
  }
  return arg;
}

// ============ 错误映射 ============

const SQLITE_BUSY = 5;
/** SQLite 主错误码取扩展码的低 8 位 */
const PRIMARY_ERROR_CODE_MASK = 255;
/*
 * 约束类**主错误码** (SQLite 官方 sqlite3.h): SQLITE_CONSTRAINT = 19,
 * 差别全在子码 (扩展码第 8~15 位)。归一化时先 `errcode & 0xFF` 取主码。
 */
const SQLITE_CONSTRAINT = 19;

/** 各约束的子码 (扩展码的第 8~15 位), 决定具体是哪种约束冲突 */
const CONSTRAINT_SUB_FOREIGNKEY = 3;
const CONSTRAINT_SUB_NOTNULL = 5;
const CONSTRAINT_SUB_PRIMARYKEY = 6;
const CONSTRAINT_SUB_TRIGGER = 7;
const CONSTRAINT_SUB_UNIQUE = 8;

/** 扩展码中子码所在的位偏移 */
const SUBCODE_SHIFT = 8;
const UNKNOWN_ERROR_CODE_PREFIX = 'UNKNOWN_SQLITE_ERROR_';

/**
 * 识别驱动错误。
 *
 * ⚠ 判据是「有 message 且 code 为 string|number」, 不看 code 的具体取值 ——
 * node:sqlite 的约束错误 code 恒为通用串 `"ERR_SQLITE_ERROR"`,
 * 真实扩展码 (2067 = UNIQUE) 藏在 `errcode` 数字字段里。
 * 若按 `code.startsWith('SQLITE_')` 之类的取值判断, 全部约束错误都会被漏掉。
 */
function isDriverError(error: unknown): error is {
  code: string | number;
  message: string;
  errcode?: number;
  errstr?: string;
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    (typeof (error as { code?: unknown }).code === 'string' ||
      typeof (error as { code?: unknown }).code === 'number') &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

function extendedCodeFromName(code: string): number | undefined {
  if (!code.startsWith(UNKNOWN_ERROR_CODE_PREFIX)) return undefined;
  const extendedCode = Number(code.slice(UNKNOWN_ERROR_CODE_PREFIX.length));
  return Number.isInteger(extendedCode) ? extendedCode : undefined;
}

function convertDriverError(error: unknown) {
  if (isDriverError(error)) {
    return {
      // 归一为字符串: Prisma 的 Error_2 类型把 originalCode 声明为 string,
      // 而 node:sqlite 的约束错误 code 是数字。原样透传会让 TS 报错,
      // 且下游按 code 做判断的代码拿不到稳定的类型。
      originalCode: String(error.code),
      originalMessage: error.message,
      // 扩展码单独留档: code 只是通用串, 排障时真正有用的是 errcode/errstr
      ...(typeof error.errcode === 'number' ? { extendedCode: error.errcode } : {}),
      ...mapDriverError(error),
    };
  }
  throw error;
}

/**
 * 错误码归一。
 *
 * ⚠ node:sqlite 的错误对象有两个码字段, 语义完全不同:
 *   code    = 'ERR_SQLITE_ERROR' (所有 SQLite 错误的通用串, 无区分度)
 *   errcode = 2067 (真实扩展码, 主码 19 + 子码 8<<8)
 * Prisma 官方的 driver 给的是字符串名 ('SQLITE_CONSTRAINT_UNIQUE')。
 *
 * 三层取值顺序: errcode 数字 → code 字符串名 → message 文本兜底。
 * 少了第一层(本项目最初的写法)所有约束错误都落进 default 变成 P2039,
 * 于是依赖 `e.code === 'P2002'` 的幂等分支永远走不到。
 */
function normalizeErrorCode(error: {
  code: string | number;
  message: string;
  errcode?: number;
}): string {
  // 1) 真实扩展码在 errcode
  if (typeof error.errcode === 'number') {
    const primary = error.errcode & PRIMARY_ERROR_CODE_MASK;
    const sub = (error.errcode >> SUBCODE_SHIFT) & PRIMARY_ERROR_CODE_MASK;
    if (primary === SQLITE_CONSTRAINT) {
      switch (sub) {
        case CONSTRAINT_SUB_PRIMARYKEY:
          return 'SQLITE_CONSTRAINT_PRIMARYKEY';
        case CONSTRAINT_SUB_NOTNULL:
          return 'SQLITE_CONSTRAINT_NOTNULL';
        case CONSTRAINT_SUB_FOREIGNKEY:
          return 'SQLITE_CONSTRAINT_FOREIGNKEY';
        case CONSTRAINT_SUB_TRIGGER:
          return 'SQLITE_CONSTRAINT_TRIGGER';
        default:
          return 'SQLITE_CONSTRAINT_UNIQUE';
      }
    }
    if (primary === SQLITE_BUSY) return 'SQLITE_BUSY';
  }

  // 2) code 已是字符串名 (Prisma 官方 driver 形态)
  if (typeof error.code === 'string' && error.code.startsWith('SQLITE_')) {
    return error.code;
  }
  if (typeof error.code === 'number') return String(error.code);

  // 3) message 文本兜底
  const msg = String(error.message ?? '');
  if (/UNIQUE constraint failed/i.test(msg)) return 'SQLITE_CONSTRAINT_UNIQUE';
  if (/NOT NULL constraint failed/i.test(msg)) return 'SQLITE_CONSTRAINT_NOTNULL';
  if (/FOREIGN KEY constraint failed/i.test(msg)) return 'SQLITE_CONSTRAINT_FOREIGNKEY';
  if (/database is locked|database table is locked/i.test(msg)) return 'SQLITE_BUSY';
  return String(error.code);
}

function mapDriverError(error: {
  code: string | number;
  message: string;
  errcode?: number;
}) {
  switch (normalizeErrorCode(error)) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY': {
      const columns = error.message.split('constraint failed: ').at(1)?.split(', ');
      const fields = columns?.map((field) => field.split('.').pop());
      const table = columns?.at(0)?.split('.').slice(0, -1).join('.') || undefined;
      return {
        kind: 'UniqueConstraintViolation' as const,
        constraint: fields !== undefined ? { fields } : undefined,
        table,
      };
    }
    case 'SQLITE_CONSTRAINT_NOTNULL': {
      const fields = error.message
        .split('constraint failed: ')
        .at(1)
        ?.split(', ')
        .map((field) => field.split('.').pop());
      return {
        kind: 'NullConstraintViolation' as const,
        constraint: { fields },
      };
    }
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
    case 'SQLITE_CONSTRAINT_TRIGGER':
      return {
        kind: 'ForeignKeyConstraintViolation' as const,
        constraint: { foreignKey: {} },
      };
    default: {
      // default 分支里 code 仍可能是数字, 统一转字符串再判断
      const codeStr = String(error.code);
      const extendedCode = extendedCodeFromName(codeStr);
      const numericCode = typeof error.code === 'number' ? error.code : undefined;
      if (
        codeStr.startsWith('SQLITE_BUSY') ||
        (numericCode !== undefined && (numericCode & PRIMARY_ERROR_CODE_MASK) === SQLITE_BUSY) ||
        (extendedCode !== undefined && (extendedCode & PRIMARY_ERROR_CODE_MASK) === SQLITE_BUSY)
      ) {
        return { kind: 'SocketTimeout' as const };
      } else if (error.message.startsWith('no such table')) {
        return {
          kind: 'TableDoesNotExist' as const,
          table: error.message.split(': ').at(1),
        };
      } else if (error.message.startsWith('no such column')) {
        return {
          kind: 'ColumnNotFound' as const,
          column: error.message.split(': ').at(1),
        };
      } else if (error.message.includes('has no column named ')) {
        return {
          kind: 'ColumnNotFound' as const,
          column: error.message.split('has no column named ').at(1),
        };
      }
      return {
        kind: 'sqlite' as const,
        extendedCode: extendedCode ?? 1,
        message: error.message,
      };
    }
  }
}

// ============ Queryable / Transaction / Adapter ============

class NodeSQLiteQueryable<TClient extends DatabaseSync> implements SqlQueryable {
  readonly provider = 'sqlite';
  readonly adapterName = 'node-sqlite';

  constructor(
    protected readonly client: TClient,
    protected readonly adapterOptions?: { timestampFormat?: string },
  ) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::queryRaw]';
    debug(`${tag} %O`, query);

    const { columnNames, declaredTypes, values } = this.performIO(query);
    const rows = values as unknown[][];
    const columnTypes = getColumnTypes(declaredTypes, rows);
    return {
      columnNames,
      columnTypes,
      rows: rows.map((row) => mapRow(row, columnTypes)),
    };
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const tag = '[js::executeRaw]';
    debug(`${tag} %O`, query);
    return this.executeIO(query).changes;
  }

  protected executeIO(query: SqlQuery): { changes: number } {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions));
      const stmt = this.client.prepare(query.sql);
      // node:sqlite 的 run() 返回 { changes, lastInsertRowid }, 逐语句变更数
      const { changes } = stmt.run(...(args as SQLInputValue[]));
      return { changes: Number(changes) };
    } catch (e) {
      this.onError(e);
    }
  }

  protected performIO(query: SqlQuery): {
    columnNames: string[];
    declaredTypes: (string | null)[];
    values: unknown[][];
  } {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions));
      const stmt = this.client.prepare(query.sql);
      // node:sqlite 无 reader 标志, 用 all() 取行; DDL/DML 语句 all() 返回空数组
      // 注意: all() 返回的是按列名键控的对象数组, 需按 columns() 的列序转为数组行
      const columns =
        (stmt as unknown as { columns?: () => { name: string; type: string | null }[] }).columns?.() ??
        [];
      const columnNames = columns.map((c) => c.name);
      const all = stmt.all(...(args as SQLInputValue[]));
      const values = all.map((row) => columnNames.map((name) => row[name]));
      return {
        declaredTypes: columns.map((c) => c.type),
        columnNames,
        values: values as unknown[][],
      };
    } catch (e) {
      this.onError(e);
    }
  }

  protected onError(error: unknown): never {
    debug('Error in performIO: %O', error);
    throw new DriverAdapterError(convertDriverError(error));
  }
}

function getColumnTypes(declaredTypes: (string | null)[], rows: unknown[][]) {
  const emptyIndices = new Set<number>();
  const result: ColumnType[] = declaredTypes.map((typeName, index) => {
    const mappedType = mapDeclType(typeName);
    if (mappedType === null) emptyIndices.add(index);
    return mappedType ?? ColumnTypeEnum.Int32;
  });
  if (emptyIndices.size === 0) return result;

  columnLoop: for (const columnIndex of emptyIndices) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const candidateValue = rows[rowIndex][columnIndex];
      if (candidateValue !== null) {
        result[columnIndex] = inferColumnType(candidateValue);
        continue columnLoop;
      }
    }
    result[columnIndex] = ColumnTypeEnum.Int32;
  }
  return result;
}

class NodeSQLiteTransaction
  extends NodeSQLiteQueryable<DatabaseSync>
  implements Transaction
{
  readonly options: TransactionOptions;

  constructor(
    client: DatabaseSync,
    options: TransactionOptions,
    adapterOptions?: { timestampFormat?: string },
    private readonly unlockParent: () => void = () => {},
  ) {
    super(client, adapterOptions);
    this.options = options;
  }

  async commit(): Promise<void> {
    debug('[js::commit]');
    this.unlockParent();
  }

  async rollback(): Promise<void> {
    debug('[js::rollback]');
    this.unlockParent();
  }

  async createSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `SAVEPOINT ${name}`, args: [], argTypes: [] });
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `ROLLBACK TO ${name}`, args: [], argTypes: [] });
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] });
  }
}

class NodeSQLiteAdapter extends NodeSQLiteQueryable<DatabaseSync> {
  #mutex = new SimpleMutex();

  constructor(client: DatabaseSync, adapterOptions?: { timestampFormat?: string }) {
    super(client, adapterOptions);
  }

  async executeScript(script: string): Promise<void> {
    try {
      this.client.exec(script);
    } catch (e) {
      this.onError(e);
    }
  }

  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      });
    }
    const options: TransactionOptions = { usePhantomQuery: false };
    const tag = '[js::startTransaction]';
    debug('%s options: %O', tag, options);
    try {
      const release = await this.#mutex.acquire();
      this.client.prepare('BEGIN').run();
      return new NodeSQLiteTransaction(this.client, options, this.adapterOptions, release);
    } catch (e) {
      this.onError(e);
    }
  }

  async dispose(): Promise<void> {
    this.client.close();
  }
}

class SimpleMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locked = false;
      const next = this.queue.shift();
      if (next) next();
    };
  }
}

export class NodeSQLiteDriverAdapterFactory
  implements SqlMigrationAwareDriverAdapterFactory
{
  readonly provider = 'sqlite';
  readonly adapterName = 'node-sqlite';

  #config: { url: string };

  constructor(config: { url: string }) {
    this.#config = config;
  }

  connect(): Promise<NodeSQLiteAdapter> {
    return Promise.resolve(new NodeSQLiteAdapter(createClient(this.#config.url)));
  }

  async connectToShadowDb(): Promise<NodeSQLiteAdapter> {
    return Promise.resolve(new NodeSQLiteAdapter(createClient(':memory:')));
  }

  async dispose(): Promise<void> {
    /* 无单例连接池需要清理 */
  }
}

function createClient(url: string): DatabaseSync {
  const dbPath = url.replace(/^file:/, '');
  const db = new DatabaseSync(dbPath);
  /*
   * 默认 busy timeout 是 0：只要另一条连接正在写（后端服务与冒烟脚本、
   * 或两个 Node 进程共用一个库），读/写就立刻抛 `database is locked`，
   * 而不是等一小会儿。5s 是 SQLite 官方推荐量级，足以覆盖正常的短事务；
   * 真的死锁时仍然会超时报错，不会静默挂起。
   */
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
