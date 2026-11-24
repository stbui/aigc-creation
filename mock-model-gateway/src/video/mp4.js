/**
 * 最小 MP4（ISO BMFF）封装器。
 *
 * 输入是 H.264 的 SPS/PPS 与一组 AVCC 格式样本，输出一个可被浏览器
 * `<video>` 播放的单轨 MP4。布局采用 faststart（ftyp + moov + mdat），
 * 这样浏览器不必先下载完整个文件才能开始播放。
 *
 * 只实现单视频轨、单 chunk、恒定帧率 —— 仿真视频不需要更多。
 */

function u8(n) {
  return Buffer.from([n & 0xff]);
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n), 0);
  return b;
}

function fourcc(type) {
  return Buffer.from(type, 'ascii');
}

/** 普通 box: size + type + payload。 */
function box(type, ...parts) {
  const payload = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  fourcc(type).copy(head, 4);
  return Buffer.concat([head, payload]);
}

/** full box: size + type + version + flags + payload。 */
function fullBox(type, version, flags, ...parts) {
  const head = Buffer.alloc(4);
  head[0] = version & 0xff;
  head[1] = (flags >>> 16) & 0xff;
  head[2] = (flags >>> 8) & 0xff;
  head[3] = flags & 0xff;
  return box(type, head, ...parts);
}

const IDENTITY_MATRIX = Buffer.concat([
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000),
]);

function ftyp() {
  return box(
    'ftyp',
    fourcc('isom'),
    u32(512),
    fourcc('isom'),
    fourcc('iso2'),
    fourcc('avc1'),
    fourcc('mp41'),
  );
}

function mvhd(timescale, duration) {
  return fullBox(
    'mvhd',
    0,
    0,
    u32(0), // creation_time
    u32(0), // modification_time
    u32(timescale),
    u32(duration),
    u32(0x00010000), // rate
    u16(0x0100), // volume
    u16(0), // reserved
    u32(0),
    u32(0),
    IDENTITY_MATRIX,
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(2), // next_track_ID
  );
}

function tkhd(timescale, duration, width, height) {
  return fullBox(
    'tkhd',
    0,
    0x000003, // enabled | in_movie
    u32(0), // creation_time
    u32(0), // modification_time
    u32(1), // track_ID
    u32(0), // reserved
    u32(duration),
    u32(0),
    u32(0),
    u16(0), // layer
    u16(0), // alternate_group
    u16(0), // volume（视频轨为 0）
    u16(0), // reserved
    IDENTITY_MATRIX,
    u32(width << 16),
    u32(height << 16),
  );
}

function mdhd(timescale, duration) {
  return fullBox(
    'mdhd',
    0,
    0,
    u32(0),
    u32(0),
    u32(timescale),
    u32(duration),
    u16(0x55c4), // language: und
    u16(0),
  );
}

function hdlr() {
  const name = Buffer.from('VideoHandler\0', 'ascii');
  return fullBox('hdlr', 0, 0, u32(0), fourcc('vide'), u32(0), u32(0), u32(0), name);
}

function vmhd() {
  return fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0));
}

function dinf() {
  const url = fullBox('url ', 0, 1);
  const dref = fullBox('dref', 0, 0, u32(1), url);
  return box('dinf', dref);
}

function avcC(sps, pps) {
  return box(
    'avcC',
    u8(1), // configurationVersion
    u8(sps[1]), // AVCProfileIndication
    u8(sps[2]), // profile_compatibility
    u8(sps[3]), // AVCLevelIndication
    u8(0xff), // lengthSizeMinusOne = 3
    u8(0xe1), // numOfSequenceParameterSets = 1
    u16(sps.length),
    sps,
    u8(1), // numOfPictureParameterSets
    u16(pps.length),
    pps,
  );
}

function avc1(width, height, sps, pps) {
  const compressorName = Buffer.alloc(32);
  const name = Buffer.from('Mock AVC', 'ascii');
  compressorName[0] = name.length;
  name.copy(compressorName, 1);
  return box(
    'avc1',
    Buffer.alloc(6), // reserved
    u16(1), // data_reference_index
    u16(0), // pre_defined
    u16(0), // reserved
    u32(0),
    u32(0),
    u32(0),
    u16(width),
    u16(height),
    u32(0x00480000), // horizresolution 72dpi
    u32(0x00480000), // vertresolution
    u32(0), // reserved
    u16(1), // frame_count
    compressorName,
    u16(0x0018), // depth
    u16(0xffff), // pre_defined = -1
    avcC(sps, pps),
  );
}

function stbl(sampleSizes, sampleCount, sampleDelta, chunkOffset, sps, pps, width, height) {
  const stsd = fullBox('stsd', 0, 0, u32(1), avc1(width, height, sps, pps));
  const stts = fullBox('stts', 0, 0, u32(1), u32(sampleCount), u32(sampleDelta));
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(sampleCount), u32(1));
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(sampleCount), ...sampleSizes.map((s) => u32(s)));
  const stco = fullBox('stco', 0, 0, u32(1), u32(chunkOffset));
  return box('stbl', stsd, stts, stsc, stsz, stco);
}

/**
 * AVCC 样本：每条 NAL 前置 4 字节长度。
 * MP4 中不使用 Annex-B 起始码。
 */
function toAvccSample(nal) {
  return Buffer.concat([u32(nal.length), nal]);
}

/**
 * @param {{
 *   width: number,
 *   height: number,
 *   fps: number,
 *   sps: Buffer,
 *   pps: Buffer,
 *   samples: Buffer[],
 * }} opts
 * @returns {Buffer}
 */
export function buildMp4({ width, height, fps, sps, pps, samples }) {
  if (!samples.length) throw new Error('MP4 至少需要一帧');
  const ftypBox = ftyp();
  // timescale 取 fps*1000，样本时长固定 1000 —— 这样 stts 里的帧率是精确的
  // 整数，不会出现 ffprobe 读出 1000/83 这类近似值。
  const timescale = Math.max(1, Math.round(fps)) * 1000;
  const sampleDelta = 1000;
  const duration = sampleDelta * samples.length;
  const avccSamples = samples.map(toAvccSample);
  const sampleSizes = avccSamples.map((s) => s.length);
  const mdatPayload = Buffer.concat(avccSamples);

  const buildMoov = (chunkOffset) =>
    box(
      'moov',
      mvhd(timescale, duration),
      box(
        'trak',
        tkhd(timescale, duration, width, height),
        box(
          'mdia',
          mdhd(timescale, duration),
          hdlr(),
          box(
            'minf',
            vmhd(),
            dinf(),
            stbl(sampleSizes, samples.length, sampleDelta, chunkOffset, sps, pps, width, height),
          ),
        ),
      ),
    );

  // 两遍构建：stco 需要知道 moov 的最终长度，而 moov 长度不受 offset 数值影响。
  const probeMoov = buildMoov(0);
  const chunkOffset = ftypBox.length + probeMoov.length + 8; // 8 = mdat box header
  const moov = buildMoov(chunkOffset);
  const mdat = box('mdat', mdatPayload);
  return Buffer.concat([ftypBox, moov, mdat]);
}
