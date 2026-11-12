import { useCallback, useState } from 'react';
import { DEFAULT_SECTIONS, MAX_SECTIONS, SECTION_VALUES } from './constants';
import { useApp } from '../../ui';

/**
 * 商品详情图页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本文件只定义「本页独有」的逻辑: 包含模块的多选; 通用的上传 / 结果轮询 /
 * 生成设置 / 价签 / AI 分析从 `src/hooks` 转出。
 *
 * 约定: `product-detail/` 下的文件不从 `src/hooks` 直接取东西, 一律经由本文件 ——
 * 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 上传 (三重校验 / 素材库回填 / 粘贴 / 排序); `UploadedImage` 是上传区的条目类型 */
export { useImageUpload, type UploadedImage } from '../../hooks/useImageUpload';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 能力运行时状态: 后台下线或无线路时在前端事前标注 */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果行的数据类型 */
export {
  hasActiveGalleryItems,
  useResultGallery,
  type GalleryItem,
} from '../../hooks/useResultGallery';
export { useRightTab, type RightTab } from '../../hooks/useRightTab';
/** 单次提交的幂等键 */
export { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
/** AI 分析：首张商品图 → 商品描述 */
export { useImageToPromptAnalysis } from '../../hooks/useImageToPromptAnalysis';
/** 模型实时报价优先的价签 */
export { useModelQuoteCreditLabel } from '../../hooks/useModelQuoteCreditLabel';
/** 平台 / 比例 / 画质的生成设置 */
export { useGenerationSettings } from '../../hooks/useGenerationSettings';
/** 实时积分单价 (后台可调价) */
export { useCreditCost } from '../../hooks/useCreditLabel';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

/**
 * 包含模块的多选状态 (上限 {@link MAX_SECTIONS}, 与参考站「已选 N/10」一致)。
 *
 * `toggle` 必须是稳定引用: 模块卡片是 memo 组件, 回调每次重建会让它跟着
 * 页面一起重渲染。顺序按模块固定顺序归一化, 不按点击先后重排。
 *
 * `applySelection` 供「重新生成」把历史参数的模块清单一键回填: 同样过滤未知
 * key 并按固定顺序归一化, 避免旧任务里的已下线模块让计数与勾选对不上。
 */
export function useSectionSelection() {
  const { message } = useApp();
  const [sections, setSections] = useState<string[]>(DEFAULT_SECTIONS);

  const toggle = useCallback(
    (value: string) => {
      setSections((prev) => {
        if (prev.includes(value)) return prev.filter((v) => v !== value);
        if (prev.length >= MAX_SECTIONS) {
          message.warning(`最多选择 ${MAX_SECTIONS} 个模块`);
          return prev;
        }
        return SECTION_VALUES.filter((v) => v === value || prev.includes(v));
      });
    },
    [message],
  );

  const applySelection = useCallback((values: string[]) => {
    const picked = new Set(values);
    setSections(SECTION_VALUES.filter((value) => picked.has(value)).slice(0, MAX_SECTIONS));
  }, []);

  return { sections, toggle, applySelection };
}
