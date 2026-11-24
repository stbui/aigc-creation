/**
 * 纯 JS 的 H.264（AVC）编码器 —— 只使用 I_PCM 宏块。
 *
 * ## 为什么是 I_PCM
 *
 * 真正的 H.264 编码需要 DCT、量化、帧内预测、CABAC/CAVLC 残差编码，
 * 在联调工具里实现完整编码器既不现实也没必要。但 H.264 **允许宏块
 * 直接以原始像素存储**（I_PCM，mb_type=25）：跳过变换与量化，只保留
 * 码流封装。这样产出的仍然是**符合规范的、浏览器可播放的 H.264**，
 * 而不是「扩展名是 mp4 的假文件」。
 *
 * 代价是体积：每宏块 256 + 128 = 384 字节，320×176 一帧约 84 KB。
 * 仿真视频默认只有几十帧，完全可接受。
 *
 * ## 码流结构
 *
 *   SPS(7) + PPS(8) + 每帧一个 IDR slice(5)
 *   全部帧都是 IDR：不依赖参考帧，任意位置都能解码。
 *
 * 规范依据：ITU-T H.264 7.3.2.1（SPS）、7.3.2.2（PPS）、7.3.3（slice header）、
 * 7.3.5（macroblock_layer，I_PCM 的 pcm_alignment_zero_bit 与原始样本）。
 */

class BitWriter {
  constructor() {
    /** @type {Buffer[]} */
    this.chunks = [];
    this.byteBuf = [];
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  writeBit(bit) {
    this.bitBuffer = ((this.bitBuffer << 1) | (bit & 1)) & 0xff;
    this.bitCount += 1;
    if (this.bitCount === 8) {
      this.byteBuf.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  writeBits(value, count) {
    for (let i = count - 1; i >= 0; i -= 1) {
      this.writeBit((value >>> i) & 1);
    }
  }

  /** 无符号指数哥伦布编码。 */
  writeUE(value) {
    const v = (value >>> 0) + 1;
    const n = 32 - Math.clz32(v);
    for (let i = 0; i < n - 1; i += 1) this.writeBit(0);
    this.writeBits(v, n);
  }

  /** 有符号指数哥伦布编码。 */
  writeSE(value) {
    this.writeUE(value <= 0 ? -2 * value : 2 * value - 1);
  }

  alignZero() {
    while (this.bitCount !== 0) this.writeBit(0);
  }

  flushByteBuf() {
    if (this.byteBuf.length) {
      this.chunks.push(Buffer.from(this.byteBuf));
      this.byteBuf = [];
    }
  }

  /** 追加原始字节（需先对齐到字节边界）。 */
  writeBytes(buffer) {
    this.alignZero();
    this.flushByteBuf();
    this.chunks.push(buffer);
  }

  toBuffer() {
    this.alignZero();
    this.flushByteBuf();
    return Buffer.concat(this.chunks);
  }
}

/** RBSP → EBSP：在 00 00 后插入 emulation_prevention_three_byte。 */
function escapeRbsp(rbsp) {
  const out = Buffer.alloc(rbsp.length * 2);
  let o = 0;
  let zeros = 0;
  for (let i = 0; i < rbsp.length; i += 1) {
    const b = rbsp[i];
    if (zeros >= 2 && b <= 0x03) {
      out[o] = 0x03;
      o += 1;
      zeros = 0;
    }
    out[o] = b;
    o += 1;
    if (b === 0x00) zeros += 1;
    else zeros = 0;
  }
  return out.subarray(0, o);
}

function nalUnit(nalRefIdc, nalUnitType, rbsp) {
  const header = ((nalRefIdc & 0x03) << 5) | (nalUnitType & 0x1f);
  const ebsp = escapeRbsp(rbsp);
  const out = Buffer.alloc(1 + ebsp.length);
  out[0] = header;
  ebsp.copy(out, 1);
  return out;
}

function trailingBits(writer) {
  writer.writeBit(1);
  writer.alignZero();
}

/**
 * 构建 SPS。profile 66 (Baseline) / level 30。
 * 宽高必须是 16 的倍数（由调用方保证）。
 */
export function buildSps(width, height) {
  const mbWidth = width / 16;
  const mbHeight = height / 16;
  if (!Number.isInteger(mbWidth) || !Number.isInteger(mbHeight)) {
    throw new Error(`视频尺寸必须是 16 的倍数: ${width}x${height}`);
  }
  const w = new BitWriter();
  w.writeBits(66, 8); // profile_idc: Baseline
  w.writeBits(0xc0, 8); // constraint_set0_flag + constraint_set1_flag
  w.writeBits(30, 8); // level_idc: 3.0
  w.writeUE(0); // seq_parameter_set_id
  w.writeUE(0); // log2_max_frame_num_minus4 → frame_num 4 bits
  w.writeUE(2); // pic_order_cnt_type = 2（只依赖 frame_num，最简单）
  w.writeUE(1); // max_num_ref_frames
  w.writeBit(0); // gaps_in_frame_num_value_allowed_flag
  w.writeUE(mbWidth - 1); // pic_width_in_mbs_minus1
  w.writeUE(mbHeight - 1); // pic_height_in_map_units_minus1
  w.writeBit(1); // frame_mbs_only_flag
  w.writeBit(1); // direct_8x8_inference_flag
  w.writeBit(0); // frame_cropping_flag
  w.writeBit(0); // vui_parameters_present_flag
  trailingBits(w);
  return nalUnit(3, 7, w.toBuffer());
}

export function buildPps() {
  const w = new BitWriter();
  w.writeUE(0); // pic_parameter_set_id
  w.writeUE(0); // seq_parameter_set_id
  w.writeBit(0); // entropy_coding_mode_flag: CAVLC
  w.writeBit(0); // bottom_field_pic_order_in_frame_present_flag
  w.writeUE(0); // num_slice_groups_minus1
  w.writeUE(0); // num_ref_idx_l0_default_active_minus1
  w.writeUE(0); // num_ref_idx_l1_default_active_minus1
  w.writeBit(0); // weighted_pred_flag
  w.writeBits(0, 2); // weighted_bipred_idc
  w.writeSE(0); // pic_init_qp_minus26
  w.writeSE(0); // pic_init_qs_minus26
  w.writeSE(0); // chroma_qp_index_offset
  w.writeBit(0); // deblocking_filter_control_present_flag
  w.writeBit(0); // constrained_intra_pred_flag
  w.writeBit(0); // redundant_pic_cnt_present_flag
  trailingBits(w);
  return nalUnit(3, 8, w.toBuffer());
}

/**
 * 一帧 RGB → YUV420 平面。
 * 使用 BT.601 全范围公式；仿真视频不追求色彩管理精度。
 */
function rgbToYuv420(rgb, width, height) {
  const yPlane = Buffer.alloc(width * height);
  const cw = width >> 1;
  const ch = height >> 1;
  const uPlane = Buffer.alloc(cw * ch);
  const vPlane = Buffer.alloc(cw * ch);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      yPlane[y * width + x] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const i = ((y * 2 + dy) * width + (x * 2 + dx)) * 3;
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
        }
      }
      r /= 4;
      g /= 4;
      b /= 4;
      uPlane[y * cw + x] = clampByte(-0.168736 * r - 0.331264 * g + 0.5 * b + 128);
      vPlane[y * cw + x] = clampByte(0.5 * r - 0.418688 * g - 0.081312 * b + 128);
    }
  }
  return { yPlane, uPlane, vPlane };
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * 构建一帧 IDR slice（I_PCM）。
 *
 * @param {{width:number,height:number,yPlane:Buffer,uPlane:Buffer,vPlane:Buffer,idrPicId:number}} opts
 */
export function buildIdrSlice({ width, height, yPlane, uPlane, vPlane, idrPicId }) {
  const mbWidth = width / 16;
  const mbHeight = height / 16;
  const cw = width >> 1;
  /*
   * slice header 与 macroblock layer 必须写在**同一个** BitWriter 里。
   * 曾经的错误做法是先把 header 落成字节（toBuffer 会补零对齐），
   * 再接着写 mb_type —— 解码器是按位连续读的，多出来的对齐位会
   * 让第一个宏块读到错的 mb_type（ffmpeg 报
   * "mb_type 207 in I slice too large at 0 0"）。
   * 真正的字节对齐只有 I_PCM 前的 pcm_alignment_zero_bit。
   */
  const writer = new BitWriter();
  writer.writeUE(0); // first_mb_in_slice
  writer.writeUE(2); // slice_type: I
  writer.writeUE(0); // pic_parameter_set_id
  writer.writeBits(0, 4); // frame_num: IDR 必须为 0
  writer.writeUE(idrPicId); // idr_pic_id
  writer.writeBit(0); // no_output_of_prior_pics_flag
  writer.writeBit(0); // long_term_reference_flag
  writer.writeSE(0); // slice_qp_delta
  // 没有 deblocking_filter_control_present_flag / slice_group_change_cycle

  for (let mby = 0; mby < mbHeight; mby += 1) {
    for (let mbx = 0; mbx < mbWidth; mbx += 1) {
      writer.writeUE(25); // mb_type: I_PCM
      writer.alignZero(); // pcm_alignment_zero_bit
      const pcm = Buffer.alloc(384);
      let o = 0;
      for (let y = 0; y < 16; y += 1) {
        const row = (mby * 16 + y) * width + mbx * 16;
        yPlane.copy(pcm, o, row, row + 16);
        o += 16;
      }
      for (let y = 0; y < 8; y += 1) {
        const row = (mby * 8 + y) * cw + mbx * 8;
        uPlane.copy(pcm, o, row, row + 8);
        o += 8;
      }
      for (let y = 0; y < 8; y += 1) {
        const row = (mby * 8 + y) * cw + mbx * 8;
        vPlane.copy(pcm, o, row, row + 8);
        o += 8;
      }
      writer.writeBytes(pcm);
    }
  }
  trailingBits(writer); // rbsp_slice_trailing_bits
  return nalUnit(3, 5, writer.toBuffer());
}

/**
 * 把若干帧 RGB 编码为 AVC 样本。
 *
 * @param {Buffer[]} frames 每帧 RGB（长度 width*height*3）
 * @param {number} width 16 的倍数
 * @param {number} height 16 的倍数
 * @returns {{ sps: Buffer, pps: Buffer, samples: Buffer[] }}
 */
export function encodeAvcFrames(frames, width, height) {
  const sps = buildSps(width, height);
  const pps = buildPps();
  const samples = frames.map((rgb, index) => {
    const { yPlane, uPlane, vPlane } = rgbToYuv420(rgb, width, height);
    return buildIdrSlice({ width, height, yPlane, uPlane, vPlane, idrPicId: index % 2 });
  });
  return { sps, pps, samples };
}
