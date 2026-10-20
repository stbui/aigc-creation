/**
 * 视频格式魔数判定 (2026-10-20)。
 *
 * 与 `image-format.ts` 同思路: **第三方 URL 不可信**, 只能看字节。
 * 视频链接常带签名参数与长 query (如 MiniMax 的防盗链 URL),
 * 按 `.mp4` 后缀猜会因 URL 里出现 `&ext=.mp4` 之类的片段而误判。
 *
 * 判定顺序按容器格式的魔数特征:
 *   - ISO BMFF (mp4/mov/m4v): 偏移 4 处是 `ftyp`
 *   - Matroska/WebM (mkv/webm): 头 4 字节是 `1A 45 DF A3`
 *   - AVI: 头是 `RIFF` 且偏移 8 处是 `AVI `
 */
export function sniffVideoFormat(buf: Buffer): string {
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    return 'video/mp4';
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'video/webm';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'AVI ') {
    return 'video/x-msvideo';
  }
  // 认不出时按 mp4 处理 —— 主流视频生成厂商都输出 mp4, 且调用方
  // 只需据此选存储扩展名
  return 'video/mp4';
}
