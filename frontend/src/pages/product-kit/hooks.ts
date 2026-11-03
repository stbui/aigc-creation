import { useCallback, useEffect, useState } from 'react';

/**
 * 商品主图工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用上传 / 结果轮询从 `src/hooks` / `src/context` 转出; 右侧页签的自动落位
 * 只服务本页, 直接定义在这里。
 *
 * 约定: `product-kit/` 下的文件不从 `src/hooks` / `src/context` 直接取东西,
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
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

/** 右侧面板页签 */
export type RightTab = 'demo' | 'results';

/**
 * 右侧面板页签。
 *
 * 首访展示功能示例; 已有历史结果时自动落到创作结果。用户自己点过页签后
 * 不再自动切换, 避免正在看示例时被晚到的列表请求弹走。
 *
 * `showResults` 供提交时调用: 批次占位卡在结果区, 留在示例页看不到进度。
 */
export function useRightTab(itemCount: number, loading: boolean) {
  const [rightTab, setRightTab] = useState<RightTab>('demo');
  const [touched, setTouched] = useState(false);

  const pick = useCallback((tab: RightTab) => {
    setTouched(true);
    setRightTab(tab);
  }, []);
  const showResults = useCallback(() => setRightTab('results'), []);

  useEffect(() => {
    if (touched || loading) return;
    if (itemCount > 0) setRightTab('results');
  }, [touched, loading, itemCount]);

  return { rightTab, pick, showResults };
}
