/**
 * AI 带货图文页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用上传 / 结果轮询从 `src/hooks` / `src/context` 转出; 只服务本页的
 * 逻辑直接定义在这里。
 *
 * 约定: `shoppable-carousel/` 下的文件不从 `src/hooks` / `src/context` 直接取东西,
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 上传 (三重校验 / 素材库回填 / 粘贴) */
export { useImageUpload, type UploadedImage } from '../../hooks/useImageUpload';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 实时积分单价 (后台可调价) */
export { useCreditLabel, useCreditCost } from '../../hooks/useCreditLabel';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果网格的数据类型 */
export { useResultGallery, type GalleryItem } from '../../hooks/useResultGallery';
/** 能力运行时真相 (是否可提交 / 不可用的原因) */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

import { useCallback, useEffect, useState } from 'react';

import type { ShoppableCarouselTemplate } from '../../types/api';
import { shoppableCarouselApi } from './api';
import { MAX_COUNT, MIN_COUNT } from './constants';

/**
 * 模板清单：分类、模板与生成张数区间。
 *
 * 本地常量只作首屏兜底：接口返回后以服务端 `countRange` 为准，
 * 避免后端调整区间时前端仍按旧值收敛/计价。
 */
export function useShoppableCarouselTemplates() {
  const [templates, setTemplates] = useState<ShoppableCarouselTemplate[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [countRange, setCountRange] = useState({ min: MIN_COUNT, max: MAX_COUNT });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await shoppableCarouselApi.templates();
      setTemplates(result.templates);
      setCategories(result.categories);
      const min = Math.trunc(Number(result.countRange?.min));
      const max = Math.trunc(Number(result.countRange?.max));
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && min <= max) {
        setCountRange({ min, max });
      }
    } catch (cause) {
      setError((cause as Error).message || '模板清单加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { templates, categories, countRange, loading, error, reload };
}
