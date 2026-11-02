/**
 * 支付账单解析自检（无需启动服务 / 无需真实渠道）。
 *
 * 覆盖：
 *   · 支付宝账单直接 CSV、ZIP(stored)、ZIP(deflate) 三种形态；
 *   · 表头前带说明行；
 *   · GB18030 字节解码（支付宝账单常见编码）；
 *   · ZIP 路径穿越/缺少 CSV 的拒绝。
 *
 * 运行：npm run verify:payment-bills
 */

import { strict as assert } from 'node:assert';
import { deflateRawSync } from 'node:zlib';
import { parseAlipayBill } from '../src/payments/adapters/alipay.adapter';
import { listZipEntries, readFirstCsvFromZip } from '../src/common/archive/zip-reader';
import { decodeCsvBuffer } from '../src/common/csv';

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

/** 构造只含一个条目的最小 ZIP（stored 或 deflate） */
function buildZip(name: string, content: Buffer, method: 0 | 8): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const payload = method === 8 ? deflateRawSync(content) : content;
  const checksum = crc32(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + nameBuf.length + payload.length;
  const centralSize = central.length + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, nameBuf, payload, central, nameBuf, eocd]);
}

const csvText = [
  '支付宝交易明细（示例说明行）',
  '商户订单号,支付宝交易号,订单金额,交易状态,完成时间',
  'HJ20261101120000ABC,2026110122001,9.90,交易成功,2026-11-01 10:00:00',
  '#业务明细汇总',
].join('\r\n');
const csv = Buffer.from(csvText, 'utf8');

for (const method of [0, 8] as const) {
  const zip = buildZip('支付宝交易明细.csv', csv, method);
  const entries = listZipEntries(zip);
  assert.equal(entries.length, 1);
  const extracted = readFirstCsvFromZip(zip);
  assert.equal(extracted.equals(csv), true);

  const records = parseAlipayBill(zip);
  assert.equal(records.length, 1, `zip method ${method} 应解析出 1 条交易`);
  assert.equal(records[0].merchantOrderNo, 'HJ20261101120000ABC');
  assert.equal(records[0].providerTradeNo, '2026110122001');
  assert.equal(records[0].amountCents, 990);
  console.log(`✓ ZIP method=${method}（含说明行）解析正确`);
}

const direct = parseAlipayBill(csv);
assert.equal(direct.length, 1);
console.log('✓ 直接 CSV 解析正确');

assert.equal(decodeCsvBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), '中文');
console.log('✓ GB18030 解码正确');

const traversalZip = buildZip('../evil.csv', csv, 0);
assert.throws(() => listZipEntries(traversalZip), /路径非法/);
console.log('✓ ZIP 路径穿越被拒绝');

const noCsvZip = buildZip('readme.txt', Buffer.from('not a bill'), 0);
assert.throws(() => parseAlipayBill(noCsvZip), /未找到 CSV/);
console.log('✓ ZIP 内无 CSV 时明确失败');

console.log('\n支付账单解析自检全部通过');
