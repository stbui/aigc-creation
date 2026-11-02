import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCreditCost } from '../../hooks/useCreditLabel';
import { DEFAULT_SECTIONS, MAX_SECTIONS, SECTION_VALUES } from './constants';
import { useApp } from '../../ui';

/**
 * 商品详情图页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本文件只定义「本页独有」的逻辑: 包含模块的多选、右侧页签的自动落位、
 * 提交区的价签; 通用的上传 / 结果轮询 / 能力状态从 `src/hooks` 转出。
 *
 * 约定: `product-detail/` 下的文件不从 `src/hooks` 直接取东西, 一律经由本文件 ——
 * 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 上传 (三重校验 / 素材库回填 / 粘贴) */
export { useImageUpload } from '../../hooks/useImageUpload';
/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 能力运行时状态: 后台下线或无线路时在前端事前标注 */
export { useCapabilityRuntime } from '../../hooks/useCapabilityRuntime';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果行的数据类型 */
export { useResultGallery, type GalleryItem } from '../../hooks/useResultGallery';
/** 实时积分单价 (后台可调价) */
export { useCreditCost } from '../../hooks/useCreditLabel';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

/** 右侧面板页签 */
export type RightTab = 'demo' | 'results';

/**
 * 包含模块的多选状态 (上限 {@link MAX_SECTIONS}, 与参考站「已选 N/10」一致)。
 *
 * `toggle` 必须是稳定引用: 模块卡片是 memo 组件, 回调每次重建会让它跟着
 * 页面一起重渲染。顺序按模块固定顺序归一化, 不按点击先后重排。
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

  return { sections, toggle };
}

/**
 * 右侧面板页签。
 *
 * 首访时结果区是空的, 默认展示「功能示例」, 否则右侧是一块什么都不说的空白卡片;
 * 已有历史产出则默认落在「创作结果」。用户自己点过页签后不再自动切换 ——
 * 正在看示例的人不该因为列表晚到一步就被弹走。
 *
 * `showResults` 供提交时调用: 生成占位卡在结果区, 留在示例页看不到进度。
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

/**
 * 提交按钮的积分价签。
 *
 * 实时价来自能力清单 (后台可调价, 限时活动可为 0), 不能写死「免费生图」。
 * 按模块逐张计费: 勾几个模块就扣几份单价, 所以乘上已选模块数。
 *
 * @param sectionCount 已选模块数
 * @returns 未取到价格时为 null (不显示价签)
 */
export function useDetailCreditLabel(sectionCount: number): string | null {
  const unitCreditCost = useCreditCost('detail_image');

  return useMemo(() => {
    if (unitCreditCost == null) return null;
    if (unitCreditCost === 0) return '限时免费';
    return `本次消耗 ${unitCreditCost * Math.max(sectionCount, 1)} 积分`;
  }, [unitCreditCost, sectionCount]);
}
