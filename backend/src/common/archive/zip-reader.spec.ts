import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { listZipEntries, readFirstCsvFromZip, readZipEntry, ZipArchiveError } from './zip-reader';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 构造单条目最小 ZIP；method 0=stored, 8=deflate */
function buildZip(name: string, content: Buffer, method = 8): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const payload = method === 8 ? deflateRawSync(content) : content;
  const checksum = crc32(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + nameBuf.length + payload.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, nameBuf, payload, central, nameBuf, eocd]);
}

describe('zip-reader', () => {
  const content = Buffer.from('商户订单号,金额\nHJ1,990\n', 'utf8');

  it.each([0, 8])('method=%i 可列出并解压', (method) => {
    const zip = buildZip('bill.csv', content, method);
    const entries = listZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('bill.csv');
    expect(readZipEntry(zip, entries[0]).equals(content)).toBe(true);
    expect(readFirstCsvFromZip(zip).equals(content)).toBe(true);
  });

  it('拒绝路径穿越', () => {
    const zip = buildZip('../evil.csv', content);
    expect(() => listZipEntries(zip)).toThrow(ZipArchiveError);
    expect(() => listZipEntries(zip)).toThrow(/路径非法/);
  });

  it('拒绝不支持的压缩方式', () => {
    const zip = buildZip('bill.csv', content, 99);
    const [entry] = listZipEntries(zip);
    expect(() => readZipEntry(zip, entry)).toThrow(/不支持的压缩方式/);
  });

  it('ZIP 内没有 CSV 时明确失败', () => {
    expect(() => readFirstCsvFromZip(buildZip('readme.txt', Buffer.from('x')))).toThrow(
      /未找到 CSV/,
    );
  });

  it('非 ZIP 输入失败', () => {
    expect(() => listZipEntries(Buffer.from('not a zip'))).toThrow(ZipArchiveError);
  });

  it('条目数超限失败', () => {
    const zip = buildZip('bill.csv', content);
    expect(() => listZipEntries(zip, { maxEntries: 0 })).toThrow(/条目数超过限制/);
  });
});
