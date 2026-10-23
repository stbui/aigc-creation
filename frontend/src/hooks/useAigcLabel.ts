import { useEffect, useState } from 'react';
import { AIGC_LABEL_FALLBACK, loadAigcLabel } from '../lib/aigc-label';
import type { PublicAigcLabel } from '../types/api';

/**
 * 视频播放器角标的展示参数。
 *
 * `active` 为 false 时不发请求 —— 图片产出已经在像素里带了角标，
 * 没必要为它们拉一份配置。首次拉取后会命中模块级缓存。
 */
export function useAigcLabel(active: boolean): PublicAigcLabel {
  const [label, setLabel] = useState<PublicAigcLabel>(AIGC_LABEL_FALLBACK);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void loadAigcLabel().then((v) => {
      if (alive) setLabel(v);
    });
    return () => {
      alive = false;
    };
  }, [active]);

  return label;
}
