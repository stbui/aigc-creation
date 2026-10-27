/**
 * 智能扩图的 placement 几何（与参考站 D_ / SMART_EXPAND 一致）。
 *
 * 「原比例」沿用源图画幅，占比同时作用于宽高；固定比例则把原图按
 * `min(画布宽/原图宽, 画布高/原图高) * 占比` 放进目标画布后再归一化。
 * 当原图与目标画幅比例不同，宽高必然不相等；仅按 occupy/100 提交会让服务端
 * 把原图拉伸到错误比例。
 */

export type ExpandPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface ExpandPlacement {
  placementX: number;
  placementY: number;
  placementWidth: number;
  placementHeight: number;
}

const CANVAS_BY_RATIO: Record<string, { width: number; height: number }> = {
  /* 源图尺寸未就绪时的占位；真正的原比例画幅由源图宽高决定。 */
  original: { width: 1, height: 1 },
  '1:1': { width: 1024, height: 1024 },
  '3:4': { width: 864, height: 1152 },
  '4:3': { width: 1152, height: 864 },
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '2:3': { width: 1024, height: 1536 },
  '3:2': { width: 1536, height: 1024 },
  '21:9': { width: 1456, height: 624 },
};

function parseRatio(ratio: string | undefined, fallbackWidth: number, fallbackHeight: number) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio ?? '');
  if (!match) return { width: fallbackWidth, height: fallbackHeight };
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? { width: w, height: h } : { width: fallbackWidth, height: fallbackHeight };
}

/** 预览盒的 aspect-ratio 与提交 placement 共用同一份目标画布定义。 */
export function getExpandCanvasAspect(
  targetRatio: string,
  sourceWidth?: number,
  sourceHeight?: number,
): string {
  if (targetRatio === 'original' && sourceWidth && sourceHeight) {
    return `${sourceWidth} / ${sourceHeight}`;
  }
  const canvas = CANVAS_BY_RATIO[targetRatio] ?? parseRatio(targetRatio, 1, 1);
  return `${canvas.width} / ${canvas.height}`;
}

export function computeExpandPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: string,
  occupy: number,
  position: string,
): ExpandPlacement {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  /*
   * 「原比例」保持源图画幅，此时 occupy 同时作用于宽高（参考站默认
   * 80% 即 80%×80%）。固定比例如 4:3 才使用目标画布做 contain 计算。
   */
  const canvas =
    targetRatio === 'original'
      ? { width, height }
      : (CANVAS_BY_RATIO[targetRatio] ?? parseRatio(targetRatio, 1, 1));
  const share = Math.max(0.01, Math.min(1, occupy / 100));
  const scale = Math.min(canvas.width / width, canvas.height / height) * share;
  const frameWidth = width * scale;
  const frameHeight = height * scale;

  const x =
    position.includes('left')
      ? 0
      : position.includes('right')
        ? canvas.width - frameWidth
        : (canvas.width - frameWidth) / 2;
  const y =
    position.includes('top')
      ? 0
      : position.includes('bottom')
        ? canvas.height - frameHeight
        : (canvas.height - frameHeight) / 2;

  return {
    placementX: Number((x / canvas.width).toFixed(6)),
    placementY: Number((y / canvas.height).toFixed(6)),
    placementWidth: Number((frameWidth / canvas.width).toFixed(6)),
    placementHeight: Number((frameHeight / canvas.height).toFixed(6)),
  };
}

export function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        reject(new Error('无法读取原图尺寸'));
      }
    };
    image.onerror = () => reject(new Error('无法读取原图尺寸，请重新上传后再试'));
    image.src = url;
  });
}
