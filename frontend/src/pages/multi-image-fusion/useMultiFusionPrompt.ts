import { useCallback, useState } from 'react';

import type { ToolAsset } from './components';
import { promptToolsApi } from './api';
import { promptToolErrorMessage } from './utils';
import { useApp } from '../../ui';

/** AI 分析的行内提示 */
export interface MultiFusionAnalysisMessage {
  kind: 'error' | 'info';
  text: string;
}

/**
 * 画面描述与「AI 分析」。
 *
 * 描述来源两条：AI 按主体图识图生成，或用户手写/编辑。留空**不报错**：
 * 提示词会退回场景版式语义（见 `definitions/multi_fusion.ts` 的 buildPrompt），
 * 这与「分析失败」是两回事，故不在前端强制必填。
 *
 * 分析走文本通道的 `promptToolsApi.imageToPrompt`（后端按 assetId 读图并校验归属）。
 * 通道未配置时后端 502 —— 如实把原因抛给用户，不编一段假的分析：
 * 编出来的描述会被当成模型看过图的结论，比"这次没分析出内容"更误导。
 */
export function useMultiFusionPrompt({ subject }: { subject: ToolAsset | null }) {
  const { message: toast } = useApp();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<MultiFusionAnalysisMessage | null>(null);
  /** AI 分析进行中 (按钮禁用 + 文案切换, 防止连点时重复请求文本通道) */
  const [analyzing, setAnalyzing] = useState(false);

  const toggle = useCallback(() => setOpen((current) => !current), []);

  const analyze = useCallback(async () => {
    setAnalysisMessage(null);
    if (!subject) {
      const text = '请先上传主体图';
      setAnalysisMessage({ kind: 'error', text });
      toast.warning(text);
      return;
    }
    setAnalyzing(true);
    try {
      const { text } = await promptToolsApi.imageToPrompt(subject.id);
      const content = text?.trim();
      if (!content) {
        const hint = '这次没有生成可用内容，请重试';
        setAnalysisMessage({ kind: 'error', text: hint });
        toast.warning(hint);
        return;
      }
      setValue(content);
      setOpen(true);
      toast.success('已按主体图生成画面描述，可继续编辑');
    } catch (e) {
      const hint = promptToolErrorMessage(e, 'image');
      setAnalysisMessage({ kind: 'error', text: hint });
      toast.error(hint);
    } finally {
      setAnalyzing(false);
    }
  }, [toast, subject]);

  return {
    value,
    setValue,
    open,
    toggle,
    message: analysisMessage,
    analyzing,
    analyze,
  };
}
