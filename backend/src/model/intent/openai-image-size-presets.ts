import type {
  ImageCapabilityConfig,
  ImageSizePreset,
} from '../domain/capability-config';

/**
 * openai-image 的标准比例 → 像素映射（1K/2K/4K）。
 *
 * 与 open-ai-canvas `openAIImageDefaultSizeTable` 保持一致。这里只做显式查表，
 * 不根据比例计算宽高：历史线路可能并不接受任意像素值，猜测会把配置错误
 * 伪装成成功请求。
 */
const OPENAI_IMAGE_SIZE_TABLE: ReadonlyArray<readonly [string, readonly [string, string, string]]> = [
  ['1:1', ['1024x1024', '2048x2048', '2880x2880']],
  ['16:9', ['1824x1024', '2752x1536', '3840x2160']],
  ['9:16', ['1024x1824', '1536x2752', '2160x3840']],
  ['4:3', ['1360x1024', '2304x1728', '3264x2448']],
  ['3:4', ['1024x1360', '1728x2304', '2448x3264']],
  ['3:2', ['1536x1024', '2496x1664', '3504x2336']],
  ['2:3', ['1024x1536', '1664x2496', '2336x3504']],
  ['4:5', ['1024x1280', '1792x2240', '2560x3200']],
  ['5:4', ['1280x1024', '2240x1792', '3200x2560']],
  ['21:9', ['2048x878', '3136x1344', '3808x1632']],
];

const OPENAI_IMAGE_TIERS = ['1k', '2k', '4k'] as const;

export function openAIImageDefaultSizePresets(): ImageSizePreset[] {
  const presets: ImageSizePreset[] = [];
  for (const [ratio, sizes] of OPENAI_IMAGE_SIZE_TABLE) {
    for (const [index, tier] of OPENAI_IMAGE_TIERS.entries()) {
      const size = sizes[index];
      const [width, height] = size.split('x').map(Number);
      presets.push({ tier, ratio, size, width, height });
    }
  }
  return presets;
}

/**
 * 兼容旧版数据库配置：openai-image 线路只保存了“像素编码的 aspectRatio
 * 参数”却没有保存 presets 时，在装载合同的内存副本中补齐标准表。
 *
 * 已有 presets 的配置一律不改，避免覆盖管理员显式声明的模型能力；补齐结果
 * 也不会写回数据库。
 */
export function fillMissingOpenAIImageSizePresets(
  image: ImageCapabilityConfig,
  protocol: string | null | undefined,
): ImageCapabilityConfig {
  if (String(protocol ?? '').trim().toLowerCase() !== 'openai-image') return image;
  if ((image.size.presets ?? []).length > 0) return image;

  const sizeParameter = (image.parameters ?? []).find(
    (parameter) => parameter.name === image.size.parameter,
  );
  if (sizeParameter?.binding !== 'aspectRatio' || sizeParameter.encoding !== 'pixels') {
    return image;
  }

  return {
    ...image,
    size: {
      ...image.size,
      presets: openAIImageDefaultSizePresets(),
      defaultTier: image.size.defaultTier || '1k',
    },
  };
}
