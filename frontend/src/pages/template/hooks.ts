/**
 * 写真模板页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用上传 / 结果轮询从 `src/hooks` / `src/context` 转出；
 * 约定：`template/` 下的文件不从 `src/hooks` / `src/context` 直接取东西，
 * 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 上传 (三重校验 / 素材库回填 / 粘贴) */
export { useImageUpload, type UploadedImage } from '../../hooks/useImageUpload';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 实时积分单价 (后台可调价) */
export { useCreditCost } from '../../hooks/useCreditLabel';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果网格的数据类型 */
export { useResultGallery, type GalleryItem } from '../../hooks/useResultGallery';
/** 能力运行时真相 (是否可提交 / 不可用的原因) */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
/** 页面 title / description / canonical */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

import { useCallback, useEffect, useState } from 'react';

import { templateApi, type TemplateCatalogCategory } from './api';

/**
 * 模板清单：分类树由后端下发，前端不复制清单。
 *
 * 加载 / 失败 / 就绪分开记录，失败时模板区展示重试入口而不是「暂无模板」。
 */
export function useTemplateCatalog() {
  const [catalog, setCatalog] = useState<TemplateCatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await templateApi.templates();
      setCatalog(result.categories);
    } catch (cause) {
      setError((cause as Error).message || '模板清单加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { catalog, loading, error, reload };
}
