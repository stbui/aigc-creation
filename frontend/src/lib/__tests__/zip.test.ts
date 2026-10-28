import { describe, expect, it } from 'vitest';
import { buildZip } from '../zip';

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer).getUint32(offset, true);
}

describe('buildZip', () => {
  it('生成带 UTF-8 文件名的 store 模式 ZIP', async () => {
    const data = new TextEncoder().encode('sku-image').buffer;
    const blob = buildZip([{ name: '01-雾蓝色.png', data }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe('application/zip');
    expect(u32(bytes, 0)).toBe(0x04034b50);
    // bit 11: 文件名按 UTF-8 解释
    expect(u16(bytes, 6) & 0x0800).toBe(0x0800);

    const nameLength = u16(bytes, 26);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
    expect(name).toBe('01-雾蓝色.png');
    expect(u32(bytes, 18)).toBe(data.byteLength);
    expect(u32(bytes, bytes.length - 22)).toBe(0x06054b50);
  });
});

