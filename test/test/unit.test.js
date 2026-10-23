import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import { paletteFrom, seededRng, sha256hex } from '../src/hash.js';
import { crc32, encodePng } from '../src/image/png.js';
import { asciiExcerpt, generateImage, parseSize } from '../src/image/generator.js';
import { measureText, wrapText } from '../src/image/font.js';
import { generateText, estimateTokens, chunkForStreaming } from '../src/text/generator.js';
import { generateVideo, pickVideoSize } from '../src/video/generator.js';
import { buildIdrSlice, buildPps, buildSps, encodeAvcFrames } from '../src/video/h264.js';
import { buildMp4 } from '../src/video/mp4.js';
import { AssetStore } from '../src/store.js';
import { maybeFail } from '../src/fail.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 解析 PNG chunk 列表（校验长度字段与 CRC）。 */
function pngChunks(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(PNG_MAGIC), 'PNG 签名不匹配');
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const crc = buffer.readUInt32BE(offset + 8 + length);
    const expected = crc32(buffer.subarray(offset + 4, offset + 8 + length));
    assert.equal(crc, expected, `${type} chunk CRC 不匹配`);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  assert.equal(offset, buffer.length, 'chunk 总长度与文件长度不一致');
  return chunks;
}

/** 解析 MP4 顶层 box。 */
function topLevelBoxes(buffer) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    assert.ok(size >= 8, `${type} box 长度非法: ${size}`);
    boxes.push({ type, offset, size });
    offset += size;
  }
  assert.equal(offset, buffer.length, 'MP4 box 总长度与文件长度不一致');
  return boxes;
}

/** 粗略找到某个 box（只下探一层，够验证结构用）。 */
function findBox(buffer, type, start = 0, end = buffer.length) {
  let offset = start;
  while (offset + 8 <= end) {
    const size = buffer.readUInt32BE(offset);
    const name = buffer.toString('ascii', offset + 4, offset + 8);
    if (name === type) return { start: offset, end: offset + size, payload: buffer.subarray(offset + 8, offset + size) };
    offset += size;
  }
  return null;
}

function hasFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

// ─────────────────────────────── hash ───────────────────────────────

test('seededRng 同种子序列一致、不同种子不同', () => {
  const a = seededRng(Buffer.from('01020304', 'hex'));
  const b = seededRng(Buffer.from('01020304', 'hex'));
  const c = seededRng(Buffer.from('05060708', 'hex'));
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  const seqC = [c(), c(), c()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('paletteFrom 命中 prompt 里的颜色词', () => {
  assert.equal(paletteFrom('a purple hero').baseHue, 270);
  assert.equal(paletteFrom('红色节日主图').baseHue, 0);
  assert.equal(paletteFrom('a blue sky').baseHue, 215);
  // 没有颜色词时按哈希派生，同输入稳定
  const first = paletteFrom('a wooden desk').baseHue;
  assert.equal(paletteFrom('a wooden desk').baseHue, first);
  assert.equal(paletteFrom('a wooden desk').baseHue, 30);
});

// ─────────────────────────────── PNG ───────────────────────────────

test('encodePng 生成合法 chunk 与 CRC', () => {
  const width = 17;
  const height = 9;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < rgb.length; i += 1) rgb[i] = i % 256;
  const png = encodePng({ width, height, rgb, texts: { Comment: 'hello 世界', Model: 'm1' } });

  const chunks = pngChunks(png);
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND'],
  );
  const ihdr = chunks[0].data;
  assert.equal(ihdr.readUInt32BE(0), width);
  assert.equal(ihdr.readUInt32BE(4), height);
  assert.equal(ihdr[8], 8, 'bit depth');
  assert.equal(ihdr[9], 2, 'color type RGB');

  const raw = inflateSync(chunks[3].data);
  assert.equal(raw.length, (width * 3 + 1) * height, 'IDAT 解压后应是逐行 filter + RGB');
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (width * 3 + 1)], 0, '每行 filter 应为 0');
  }

  const comment = chunks[1].data.toString('utf8');
  assert.ok(comment.includes('Comment\0hello 世界'));
});

test('encodePng 拒绝尺寸与像素长度不符', () => {
  assert.throws(() => encodePng({ width: 4, height: 4, rgb: Buffer.alloc(10) }), /像素长度不符/);
  assert.throws(() => encodePng({ width: 0, height: 4, rgb: Buffer.alloc(0) }), /尺寸非法/);
});

// ─────────────────────────────── 图像 ───────────────────────────────

test('parseSize 解析、取整与像素上限', () => {
  assert.deepEqual(parseSize('512x288'), { width: 512, height: 288 });
  assert.deepEqual(parseSize(' 300 x 200 '), { width: 300, height: 200 });
  assert.deepEqual(parseSize('16x16'), { width: 64, height: 64 }, '下限 64');
  assert.deepEqual(parseSize('4x4'), { width: 1024, height: 1024 }, '不足两位的数字不当作尺寸');
  assert.deepEqual(parseSize(undefined), { width: 1024, height: 1024 });

  const capped = parseSize('2048x2048', 100_000);
  assert.ok(capped.width * capped.height <= 100_000 * 1.05, `像素未被限制: ${capped.width}x${capped.height}`);
  assert.ok(capped.width >= 64 && capped.height >= 64);
});

test('generateImage 输出真实 PNG，且同输入可复现', () => {
  const opts = { prompt: 'a purple mug on white marble', model: 'gpt-image-2', size: '256x144', seed: 42 };
  const first = generateImage(opts);
  const second = generateImage(opts);
  assert.ok(first.buffer.equals(second.buffer), '相同 prompt/model/seed 应得到相同字节');

  const different = generateImage({ ...opts, seed: 43 });
  assert.ok(!first.buffer.equals(different.buffer), '不同 seed 应得到不同画面');

  const chunks = pngChunks(first.buffer);
  assert.equal(chunks[0].data.readUInt32BE(0), first.width);
  assert.equal(chunks[0].data.readUInt32BE(4), first.height);
  const comment = chunks.find((c) => c.type === 'tEXt' && c.data.toString('latin1').startsWith('Comment'));
  assert.ok(comment && comment.data.toString('utf8').includes(opts.prompt), '完整 prompt 应写入 tEXt');
  assert.equal(first.mime, 'image/png');
  assert.ok(first.revisedPrompt.includes(opts.prompt));
});

test('asciiExcerpt 去掉非 ASCII 并限长', () => {
  assert.equal(asciiExcerpt('红色礼盒'), 'VISUAL SYNTHESIS');
  assert.equal(asciiExcerpt('  a   purple   mug  '), 'a purple mug');
  const long = asciiExcerpt('x'.repeat(300), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith('.'));
});

test('wrapText 不会产生超宽行（宽度足够时）', () => {
  const scale = 2;
  const maxWidth = 200;
  const lines = wrapText('a rather long english prompt that must wrap across several lines', maxWidth, scale);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(measureText(line, scale) <= maxWidth, `行超宽: ${line}`);
  }
  // 无空格长串按字符折行，不能死循环
  const chars = wrapText('x'.repeat(80), 100, 2);
  assert.ok(chars.length > 1);
  for (const line of chars) assert.ok(measureText(line, 2) <= 100);
});

// ─────────────────────────────── 视频 ───────────────────────────────

test('pickVideoSize 产出 16 的倍数且长边不超过 320', () => {
  assert.deepEqual(pickVideoSize('1280x720'), { width: 320, height: 176 });
  assert.deepEqual(pickVideoSize(undefined, '720P'), { width: 320, height: 176 });
  const portrait = pickVideoSize('720x1280');
  assert.equal(portrait.height, 320);
  assert.ok(portrait.width % 16 === 0 && portrait.height % 16 === 0);
  const square = pickVideoSize('512x512');
  assert.ok(square.width % 16 === 0 && square.height % 16 === 0);
  assert.equal(square.width, 320);
});

test('H.264 编码：SPS/PPS/IDR 头部与宏块数量正确', () => {
  const width = 32;
  const height = 16;
  const sps = buildSps(width, height);
  const pps = buildPps();
  assert.equal(sps[0] & 0x1f, 7, 'SPS NAL type');
  assert.equal(pps[0] & 0x1f, 8, 'PPS NAL type');
  assert.equal(sps[1], 66, 'Baseline profile');

  const yPlane = Buffer.alloc(width * height, 128);
  const uPlane = Buffer.alloc((width / 2) * (height / 2), 128);
  const vPlane = Buffer.alloc((width / 2) * (height / 2), 128);
  const slice = buildIdrSlice({ width, height, yPlane, uPlane, vPlane, idrPicId: 0 });
  assert.equal(slice[0] & 0x1f, 5, 'IDR slice NAL type');

  const { samples } = encodeAvcFrames([Buffer.alloc(width * height * 3, 90)], width, height);
  assert.equal(samples.length, 1);
  // 2 个宏块 × 384 字节 + slice header + 尾部，允许少量开销
  assert.ok(samples[0].length >= 2 * 384 && samples[0].length < 2 * 384 + 64, `样本长度异常: ${samples[0].length}`);
});

test('MP4 封装包含 ftyp/moov/mdat 与正确的样本数', () => {
  const width = 32;
  const height = 16;
  const rgb = Buffer.alloc(width * height * 3, 40);
  const { sps, pps, samples } = encodeAvcFrames([rgb, rgb, rgb], width, height);
  const mp4 = buildMp4({ width, height, fps: 12, sps, pps, samples });

  const boxes = topLevelBoxes(mp4);
  assert.deepEqual(
    boxes.map((b) => b.type),
    ['ftyp', 'moov', 'mdat'],
  );

  const moov = findBox(mp4, 'moov');
  const trak = findBox(mp4, 'trak', moov.start + 8, moov.end);
  const mdia = findBox(mp4, 'mdia', trak.start + 8, trak.end);
  const minf = findBox(mp4, 'minf', mdia.start + 8, mdia.end);
  const stbl = findBox(mp4, 'stbl', minf.start + 8, minf.end);
  const stsz = findBox(mp4, 'stsz', stbl.start + 8, stbl.end);
  assert.ok(stsz, '缺少 stsz');
  assert.equal(stsz.payload.readUInt32BE(8), 3, 'stsz 样本数');

  const stco = findBox(mp4, 'stco', stbl.start + 8, stbl.end);
  // fullbox: version/flags(4) + entry_count(4) + 第一个 chunk offset(4)
  const chunkOffset = stco.payload.readUInt32BE(8);
  const mdat = findBox(mp4, 'mdat');
  assert.equal(chunkOffset, mdat.start + 8, 'stco 应指向 mdat 第一个样本');
});

test('生成的视频可被 ffmpeg 完整解码', { skip: !hasFfmpeg() && 'ffmpeg 不可用' }, () => {
  const video = generateVideo({ prompt: 'a blue cube rotating', model: 'mock-video', size: '320x176', seconds: 1 });
  const dir = mkdtempSync(join(tmpdir(), 'mock-gw-'));
  const file = join(dir, 'sample.mp4');
  try {
    writeFileSync(file, video.buffer);
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(decoded.status, 0, `ffmpeg 解码失败: ${decoded.stderr}`);
    assert.equal(String(decoded.stderr).trim(), '', `ffmpeg 报告了错误: ${decoded.stderr}`);

    const probe = spawnSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_frames', '-of', 'json', file],
      { encoding: 'utf8', timeout: 30_000 },
    );
    if (probe.status === 0) {
      const stream = JSON.parse(probe.stdout).streams[0];
      assert.equal(stream.codec_name, 'h264');
      assert.equal(stream.width, video.width);
      assert.equal(stream.height, video.height);
      assert.equal(Number(stream.nb_frames), video.frameCount);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateVideo 输出结构完整且可复现', () => {
  const opts = { prompt: 'a red box on a turntable', model: 'MiniMax-Hailuo-2.3', seconds: 1, seed: 3 };
  const first = generateVideo(opts);
  const second = generateVideo(opts);
  assert.ok(first.buffer.equals(second.buffer), '相同输入应得到相同视频');
  assert.equal(first.fps, 12);
  assert.equal(first.frameCount, 12);
  assert.equal(first.durationSeconds, 1);
  assert.equal(first.mime, 'video/mp4');
  assert.ok(first.buffer.subarray(4, 8).toString('ascii') === 'ftyp');
});

// ─────────────────────────────── 文本 ───────────────────────────────

test('generateText 中文/英文识别与 usage 自洽', () => {
  const zh = generateText({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: '帮我写一个紫砂壶的商品主图提示词' }],
  });
  assert.equal(zh.detectedLanguage, 'zh');
  assert.ok(zh.content.includes('仿真'));
  assert.equal(zh.usage.total_tokens, zh.usage.prompt_tokens + zh.usage.completion_tokens);
  assert.equal(zh.finishReason, 'stop');

  const en = generateText({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Write a prompt for a purple mug on marble' }],
  });
  assert.equal(en.detectedLanguage, 'en');
  assert.ok(en.content.includes('SIMULATED'));

  const same = generateText({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Write a prompt for a purple mug on marble' }],
  });
  assert.equal(en.content, same.content, '同输入应稳定复现');
});

test('generateText 识别多模态图片块', () => {
  const result = generateText({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '分析这张图，给出提示词' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } },
        ],
      },
    ],
  });
  assert.equal(result.imageCount, 2);
  assert.ok(result.content.includes('2 张'), result.content.slice(0, 80));
});

test('max_tokens 截断并给出提示', () => {
  const result = generateText({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: '写一个很长的电商文案' }],
    maxTokens: 30,
  });
  assert.ok(result.content.includes('截断'), result.content);
  assert.ok(estimateTokens(result.content) <= 60, `截断后仍过长: ${estimateTokens(result.content)}`);
});

test('chunkForStreaming 拼回原文', () => {
  const text = '你好，world! 这是一段用于流式输出的文本。';
  const chunks = chunkForStreaming(text, 5);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), text);
});

// ─────────────────────────────── 失败注入 / 存储 ───────────────────────────────

test('maybeFail 按标记抛对应状态码', () => {
  const cfg = { failRate: 0 };
  assert.throws(() => maybeFail(cfg, '[[fail]]'), (e) => e.status === 500);
  assert.throws(() => maybeFail(cfg, '[[500]]'), (e) => e.status === 500);
  assert.throws(() => maybeFail(cfg, '[[401]]'), (e) => e.status === 401);
  assert.throws(() => maybeFail(cfg, '[[429]]'), (e) => e.status === 429);
  assert.doesNotThrow(() => maybeFail(cfg, '正常提示词'));
});

test('AssetStore 按 TTL 与容量淘汰', () => {
  const store = new AssetStore({ ttlMs: 60_000, maxBytes: 100 });
  const a = store.put(Buffer.alloc(60, 1), { mime: 'image/png', ext: 'png' });
  const b = store.put(Buffer.alloc(60, 2), { mime: 'image/png', ext: 'png' });
  assert.equal(store.get(a.id), null, '超出容量时应淘汰最老的');
  assert.ok(store.get(b.id)?.buffer.length === 60);
  assert.equal(store.stats().bytes, 60);

  const store2 = new AssetStore({ ttlMs: 1, maxBytes: 1000 });
  const c = store2.put(Buffer.alloc(4), { mime: 'image/png', ext: 'png' });
  store2.cleanup(Date.now() + 10);
  assert.equal(store2.get(c.id), null, 'TTL 到期应删除');
  store.dispose();
  store2.dispose();
});

test('sha256hex 稳定且长度正确', () => {
  assert.equal(sha256hex('abc').length, 64);
  assert.equal(sha256hex('abc'), sha256hex('abc'));
});
