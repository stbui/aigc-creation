/**
 * 支持的图片格式 —— **格式白名单的唯一事实源**。
 *
 * 放在 `common/` 而不是 `assets/`，因为两处都要用：
 *   1. `assets/image-validation.ts` 判定上传文件的真实格式（按字节魔数）
 *   2. `common/settings.service.ts` 校验 `upload.allowedTypes` 设置项的取值
 *
 * 后者尤其关键：设置项允许运营收窄允许的类型，但**接收端只认得这三种** ——
 * 若允许运营写一个后端根本不认识的格式（如 gif），页面会显示「已允许 GIF」，
 * 而上传时依然被拒 —— 这正是本轮要消灭的「配置与行为分叉」。
 *
 * ⚠️ 格式判定必须按**字节魔数**，不能看 URL 后缀或客户端声明的 mimetype。
 */
export const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export type SupportedImageExt = (typeof SUPPORTED_IMAGE_EXTS)[number];

/** 扩展名 → 真实 mime。注意 jpg 与 jpeg 是同一个格式的两种写法 */
export const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** 真实 mime → 落库扩展名 */
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * 把 `upload.allowedTypes` 的取值（逗号分隔扩展名）解析成真实 mime 列表。
 *
 * 未登记的扩展名直接丢弃 —— 防御性的一层，避免手工改库塞进奇怪的值。
 */
export function parseAllowedMimes(raw: string | null | undefined): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const mimes: string[] = [];
  for (const ext of list) {
    const mime = EXT_TO_MIME[ext];
    if (mime && !mimes.includes(mime)) mimes.push(mime);
  }
  return mimes;
}

/** 设置项取值里的扩展名是否全部是后端认识的格式 */
export function unknownAllowedExts(raw: string | null | undefined): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.filter((ext) => !EXT_TO_MIME[ext]);
}
