import { inflateRawSync } from 'node:zlib';

/**
 * 只读 ZIP 解析（stored / deflate）。
 *
 * 用途：渠道账单（支付宝交易明细 ZIP）等「只读、不落盘、不解压整包」的场景。
 * 与 `model/protocol/package.ts` 的插件包解析职责不同：那边有插件路径白名单
 * 与 manifest 校验；这里只提供通用的中央目录读取与单条目解压，并强制大小上限。
 *
 * 安全约束：
 *   · 条目数 / 单条大小 / 总解压大小都有限制，避免 zip bomb；
 *   · 只允许 stored(0) / deflate(8)；
 *   · 拒绝绝对路径、`..`、反斜杠与符号链接（即使不落盘，也避免调用方误写文件）；
 *   · 不跟随条目里的任何内容执行。
 */

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipArchiveError';
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ZipLimits {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

const DEFAULT_LIMITS: Required<ZipLimits> = {
  maxEntries: 256,
  maxEntryBytes: 64 << 20,
  maxTotalBytes: 256 << 20,
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** 读取并校验中央目录；不解压条目 */
export function listZipEntries(data: Buffer, limits: ZipLimits = {}): ZipEntry[] {
  const limitsWithDefaults = { ...DEFAULT_LIMITS, ...limits };
  if (!data || data.length < 22) throw new ZipArchiveError('ZIP 文件过短');

  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new ZipArchiveError('不是有效的 ZIP 文件（缺少中央目录结束记录）');

  const totalEntries = data.readUInt16LE(eocd + 10);
  const directorySize = data.readUInt32LE(eocd + 12);
  const directoryOffset = data.readUInt32LE(eocd + 16);
  if (totalEntries === 0) throw new ZipArchiveError('ZIP 文件没有条目');
  if (totalEntries > limitsWithDefaults.maxEntries) {
    throw new ZipArchiveError(`ZIP 条目数超过限制（${limitsWithDefaults.maxEntries}）`);
  }
  if (
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff ||
    directoryOffset + directorySize > data.length
  ) {
    throw new ZipArchiveError('ZIP 中央目录越界或使用了不支持的 ZIP64 格式');
  }

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let cursor = directoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipArchiveError('ZIP 中央目录损坏');
    }
    const versionMadeBy = data.readUInt16LE(cursor + 4);
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const externalAttributes = data.readUInt32LE(cursor + 38);
    const localOffset = data.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > data.length) throw new ZipArchiveError('ZIP 条目名越界');
    const name = data.subarray(cursor + 46, nameEnd).toString('utf8');

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new ZipArchiveError(`ZIP 条目 ${name} 使用了不支持的 ZIP64 格式`);
    }
    if (uncompressedSize > limitsWithDefaults.maxEntryBytes) {
      throw new ZipArchiveError(`ZIP 条目 ${name} 超过单条大小限制`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > limitsWithDefaults.maxTotalBytes) {
      throw new ZipArchiveError('ZIP 解压后总大小超过限制');
    }
    validateEntryName(name);
    validateEntryAttributes(name, versionMadeBy, externalAttributes);

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** 解压单个条目；调用方负责先用 listZipEntries 取得条目 */
export function readZipEntry(
  data: Buffer,
  entry: ZipEntry,
  maxBytes: number = DEFAULT_LIMITS.maxEntryBytes,
): Buffer {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipArchiveError(`ZIP 条目 ${entry.name} 使用了不支持的压缩方式：${entry.method}`);
  }
  if (entry.uncompressedSize > maxBytes) {
    throw new ZipArchiveError(`ZIP 条目 ${entry.name} 超过大小限制`);
  }

  const headerOffset = entry.localOffset;
  if (headerOffset + 30 > data.length || data.readUInt32LE(headerOffset) !== LOCAL_SIGNATURE) {
    throw new ZipArchiveError(`ZIP 条目 ${entry.name} 的本地文件头损坏`);
  }
  const nameLength = data.readUInt16LE(headerOffset + 26);
  const extraLength = data.readUInt16LE(headerOffset + 28);
  const start = headerOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > data.length) throw new ZipArchiveError(`ZIP 条目 ${entry.name} 越界`);

  const payload = data.subarray(start, end);
  if (entry.method === 0) return Buffer.from(payload);

  try {
    const output = inflateRawSync(payload, { maxOutputLength: maxBytes + 1 });
    if (output.length > maxBytes) throw new ZipArchiveError(`ZIP 条目 ${entry.name} 解压后超过大小限制`);
    return output;
  } catch (error) {
    if (error instanceof ZipArchiveError) throw error;
    throw new ZipArchiveError(`ZIP 条目 ${entry.name} 解压失败：${(error as Error).message}`);
  }
}

/** 账单 ZIP：取出第一个 `.csv` 条目（支付宝交易明细） */
export function readFirstCsvFromZip(data: Buffer, maxBytes: number = 64 << 20): Buffer {
  const entries = listZipEntries(data, {
    maxEntries: 64,
    maxEntryBytes: maxBytes,
    maxTotalBytes: maxBytes * 2,
  });
  const csv = entries.find(
    (entry) => !entry.name.endsWith('/') && entry.name.toLowerCase().endsWith('.csv'),
  );
  if (!csv) throw new ZipArchiveError('ZIP 内未找到 CSV 文件');
  return readZipEntry(data, csv, maxBytes);
}

function findEndOfCentralDirectory(data: Buffer): number {
  // EOCD 固定 22 字节，后面最多 64KB 注释
  const minOffset = Math.max(0, data.length - 22 - 0xffff);
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function validateEntryName(name: string): void {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    name.split('/').includes('..')
  ) {
    throw new ZipArchiveError(`ZIP 条目路径非法：${name}`);
  }
}

/** unix 模式 0xA000 表示符号链接；账单/普通文件不应出现 */
function validateEntryAttributes(name: string, versionMadeBy: number, externalAttributes: number): void {
  if ((versionMadeBy >> 8) !== 3) return;
  const mode = externalAttributes >>> 16;
  if ((mode & 0xf000) === 0xa000) {
    throw new ZipArchiveError(`ZIP 不允许符号链接条目：${name}`);
  }
}
