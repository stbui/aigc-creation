import { useCallback, useState } from 'react';

/**
 * AI 带货图文页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用上传 / 结果轮询从 `src/hooks` / `src/context` 转出; 只服务本页的
 * 逻辑（模板清单加载、右侧页签落位）直接定义在这里。
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

/**
 * 右侧面板页签。
 *
 * 与 `product-kit` 的 `useRightTab` **刻意不同**: 商品主图的默认页签是
 * 「功能示例」（纯说明）, 有历史时切到结果合理; 而带货图文的默认页签是
 * 「模板」, 模板是**操作必需**的（模板生成模式必须在右侧选模板）。
 * 若因为账号有历史就自动跳到「创作结果」, 用户会看不到模板、也不知道
 * 该去哪里选 —— 页签角标已经提示了历史条数, 不需要再抢走视线。
 *
 * `showResults` 供提交时调用: 批次占位卡在结果区, 留在模板页看不到进度。
 */
export type RightTab = 'templates' | 'results';

export function useRightTab() {
  const [rightTab, setRightTab] = useState<RightTab>('templates');

  const pick = useCallback((tab: RightTab) => setRightTab(tab), []);
  const showResults = useCallback(() => setRightTab('results'), []);

  return { rightTab, pick, showResults };
}
