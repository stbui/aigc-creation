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

/** 部署硬上限。运营配置只能在此范围内收紧，不能突破进程与解码资源边界。 */
export const DEPLOYMENT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const DEPLOYMENT_UPLOAD_MAX_PIXELS = 200_000_000;

export function deploymentUploadMaxBytes(): number {
  return DEPLOYMENT_UPLOAD_MAX_BYTES;
}

export function deploymentUploadMaxPixels(): number {
  return DEPLOYMENT_UPLOAD_MAX_PIXELS;
}

/** 后端可以真实识别、校验与存储的图片 MIME，顺序即设置页与错误提示中的展示顺序。 */
export const SUPPORTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number];

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

/** 面向用户的格式名。与 MIME 常量同序，避免各页面各写一套大小写。 */
export const MIME_TO_LABEL: Record<SupportedImageMime, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

/**
 * 把 `upload.allowedTypes` 的取值（逗号分隔扩展名）解析成真实 mime 列表。
 *
 * 未登记的扩展名直接丢弃 —— 防御性的一层，避免手工改库塞进奇怪的值。
 */
export function parseAllowedMimes(raw: string | null | undefined): SupportedImageMime[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const mimes: SupportedImageMime[] = [];
  for (const ext of list) {
    const mime = EXT_TO_MIME[ext] as SupportedImageMime | undefined;
    if (mime && !mimes.includes(mime)) mimes.push(mime);
  }
  return mimes;
}

/**
 * 把任意合法扩展名组合归一成稳定落库值。
 *
 * `jpg` / `jpeg` 是同一格式；调用方只需要知道“JPEG 是否允许”，不需要记住
 * 运营当初写的是哪一个别名。输出顺序固定，便于设置页判断草稿是否有变化。
 */
export function canonicalAllowedTypes(raw: string | null | undefined): string {
  const allowed = new Set(parseAllowedMimes(raw));
  return SUPPORTED_IMAGE_MIMES.filter((mime) => allowed.has(mime))
    .map((mime) => MIME_TO_EXT[mime])
    .join(',');
}

/** MIME 列表 → 用户可读格式名，保持 SUPPORTED_IMAGE_MIMES 的稳定顺序。 */
export function allowedTypeLabels(mimes: readonly SupportedImageMime[]): string[] {
  const allowed = new Set(mimes);
  return SUPPORTED_IMAGE_MIMES.filter((mime) => allowed.has(mime)).map(
    (mime) => MIME_TO_LABEL[mime],
  );
}

/** 设置项取值里的扩展名是否全部是后端认识的格式 */
export function unknownAllowedExts(raw: string | null | undefined): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.filter((ext) => !EXT_TO_MIME[ext]);
}
