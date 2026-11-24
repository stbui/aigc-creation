import { deflateSync } from 'node:zlib';

/**
 * 最小 PNG 编码器（8-bit RGB）。
 *
 * 真实实现，不是把固定字节返回出去：接收任意 RGB 光栅，逐行加 filter
 * 字节、zlib 压缩、写 IHDR / IDAT / IEND，并逐 chunk 计算 CRC32。
 * 这样本项目后端按字节魔数判格式（PNG 签名 89 50 4E 47）一定能认出来。
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/**
 * @param {{ width: number, height: number, rgb: Buffer, texts?: Record<string,string> }} opts
 * @returns {Buffer}
 */
export function encodePng({ width, height, rgb, texts = {} }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`PNG 尺寸非法: ${width}x${height}`);
  }
  if (rgb.length !== width * height * 3) {
    throw new Error(`PNG 像素长度不符: 期望 ${width * height * 3}, 实际 ${rgb.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前置 filter 字节 0 (None)。数据本身已经是光栅顺序。
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const chunks = [SIGNATURE, chunk('IHDR', ihdr)];
  for (const [key, value] of Object.entries(texts)) {
    if (value === undefined || value === null || value === '') continue;
    // tEXt: keyword\0text，keyword 限 1-79 个 Latin-1 字符
    const keyBuf = Buffer.from(String(key).slice(0, 79), 'latin1');
    const valBuf = Buffer.from(String(value), 'utf8');
    chunks.push(chunk('tEXt', Buffer.concat([keyBuf, Buffer.from([0]), valBuf])));
  }
  chunks.push(chunk('IDAT', deflateSync(raw, { level: 6 })));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
