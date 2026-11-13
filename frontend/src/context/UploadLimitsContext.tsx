import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  publicSettingsApi,
  UPLOAD_LIMITS_CHANGED_EVENT,
  type PublicUploadLimits,
} from '../lib/api-settings';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  SUPPORTED_IMAGE_TYPES,
} from '../lib/constants';

/** 与后端默认值一致；接口失败时页面继续可用，不做阻断。 */
const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000;

const FALLBACK_LIMITS: PublicUploadLimits = {
  maxSizeMb: MAX_IMAGE_MB,
  maxBytes: MAX_IMAGE_BYTES,
  maxPixels: DEFAULT_MAX_IMAGE_PIXELS,
  allowedTypes: 'jpg,png,webp',
  allowedMimes: [...SUPPORTED_IMAGE_TYPES],
  allowedLabels: SUPPORTED_IMAGE_LABEL.split(' / '),
};

export interface UploadLimitsValue extends PublicUploadLimits {
  /** `maxSizeMb` 的短别名，供上传组件直接消费。 */
  maxMb: number;
  /** file input 的 accept；由当前允许格式生成。 */
  accept: string;
  /** 提示文案使用的格式名，例如 `PNG / JPG / WebP`。 */
  allowedLabel: string;
  /** 同步格式校验，适合 onChange / drop 的第一道过滤。 */
  isSupportedImageFile: (file: { type: string; name?: string }) => boolean;
  /**
   * 完整前端预检：格式、字节数和像素总数。
   * 返回可直接展示的错误文案；通过时返回 null。后端仍会独立复核真实文件。
   */
  validateImageFile: (file: File) => Promise<string | null>;
  /** 重新读取公开配置。失败时保留当前快照。 */
  refresh: () => Promise<void>;
}

function normalizeMime(type: string): string {
  return type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : type.toLowerCase();
}

function extensionOf(name: string | undefined): string {
  return name?.split('.').pop()?.toLowerCase() ?? '';
}

function normalizeSnapshot(raw: PublicUploadLimits): PublicUploadLimits {
  const maxSizeMb =
    Number.isFinite(raw.maxSizeMb) && raw.maxSizeMb > 0 ? raw.maxSizeMb : MAX_IMAGE_MB;
  const maxBytes =
    Number.isFinite(raw.maxBytes) && raw.maxBytes > 0
      ? raw.maxBytes
      : Math.min(maxSizeMb * 1024 * 1024, MAX_IMAGE_BYTES);
  const maxPixels =
    Number.isFinite(raw.maxPixels) && raw.maxPixels > 0
      ? raw.maxPixels
      : DEFAULT_MAX_IMAGE_PIXELS;
  const allowedMimes =
    Array.isArray(raw.allowedMimes) && raw.allowedMimes.length > 0
      ? raw.allowedMimes.map(normalizeMime)
      : [...SUPPORTED_IMAGE_TYPES];
  const allowedLabels =
    Array.isArray(raw.allowedLabels) && raw.allowedLabels.length > 0
      ? raw.allowedLabels
      : allowedMimes.map((mime) => mime.replace('image/', '').toUpperCase());
  return {
    maxSizeMb,
    maxBytes,
    maxPixels,
    allowedTypes: raw.allowedTypes || 'jpg,png,webp',
    allowedMimes,
    allowedLabels,
  };
}

async function readImagePixels(file: File): Promise<number | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      return pixels;
    } catch {
      /* 回退到 <img> 解码，兼容不支持 createImageBitmap 的浏览器。 */
    }
  }
  if (typeof Image === 'undefined') return null;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const pixels = image.naturalWidth * image.naturalHeight;
      URL.revokeObjectURL(url);
      resolve(pixels > 0 ? pixels : null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

const fallbackValue: UploadLimitsValue = {
  ...FALLBACK_LIMITS,
  maxMb: FALLBACK_LIMITS.maxSizeMb,
  accept: SUPPORTED_IMAGE_ACCEPT,
  allowedLabel: SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile: (file) =>
    SUPPORTED_IMAGE_TYPES.includes(normalizeMime(file.type) as (typeof SUPPORTED_IMAGE_TYPES)[number]),
  validateImageFile: async (file) => {
    if (!fallbackValue.isSupportedImageFile(file)) {
      return `请选择 ${SUPPORTED_IMAGE_LABEL} 格式的图片`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `单张图片不能超过 ${MAX_IMAGE_MB}MB`;
    }
    return null;
  },
  refresh: async () => {},
};

const UploadLimitsContext = createContext<UploadLimitsValue>(fallbackValue);

export function UploadLimitsProvider({ children }: { children: ReactNode }) {
  const [limits, setLimits] = useState<PublicUploadLimits>(FALLBACK_LIMITS);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await publicSettingsApi.read();
      if (mountedRef.current) setLimits(normalizeSnapshot(snapshot.upload));
    } catch {
      // 公开配置不是业务前置条件：网络失败时继续使用本地兜底。
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const handleRefresh = () => void refresh();
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener(UPLOAD_LIMITS_CHANGED_EVENT, handleRefresh);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(UPLOAD_LIMITS_CHANGED_EVENT, handleRefresh);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  const value = useMemo<UploadLimitsValue>(() => {
    const allowedMimeSet = new Set(limits.allowedMimes.map(normalizeMime));
    const allowedExtSet = new Set(limits.allowedTypes.split(',').map((item) => item.trim()));
    const isSupportedImageFile = (file: { type: string; name?: string }) => {
      const mime = normalizeMime(file.type);
      if (mime) return allowedMimeSet.has(mime);
      return allowedExtSet.has(extensionOf(file.name));
    };
    return {
      ...limits,
      maxMb: limits.maxSizeMb,
      accept: limits.allowedMimes.join(','),
      allowedLabel: limits.allowedLabels.join(' / '),
      isSupportedImageFile,
      validateImageFile: async (file) => {
        if (!isSupportedImageFile(file)) {
          return `请选择 ${limits.allowedLabels.join(' / ')} 格式的图片`;
        }
        if (file.size > limits.maxBytes) {
          return `单张图片不能超过 ${limits.maxSizeMb}MB`;
        }
        const pixels = await readImagePixels(file);
        if (pixels !== null && pixels > limits.maxPixels) {
          return `图片像素总数不能超过 ${limits.maxPixels.toLocaleString('zh-CN')}`;
        }
        return null;
      },
      refresh,
    };
  }, [limits, refresh]);

  return <UploadLimitsContext.Provider value={value}>{children}</UploadLimitsContext.Provider>;
}

export function useUploadLimits(): UploadLimitsValue {
  return useContext(UploadLimitsContext);
}
