import { useCallback, useEffect, useRef, useState } from 'react';
import { promptToolsApi } from '../lib/api';
import { promptToolErrorMessage } from '../lib/promptToolMessages';
import { useApp } from '../ui';
import type { UploadedImage } from './useImageUpload';

interface Options {
  /** 当前输入位上的图片；分析只取首张 */
  images: UploadedImage[];
  /** 当前文本值；响应回来时按最新值判断是否提示覆盖 */
  value: string;
  onApply: (value: string) => void;
}

/**
 * 「AI 分析」—— 走文本通道的「图片转提示词」，对首张商品图做真实识别。
 *
 * 商品主图与商品详情共用同一套失败语义：文本通道没配时后端返回 502，
 * 如实把原因抛给用户；绝不退回「用文件名拼一段描述」—— 那会让用户以为
 * 模型看过图。已填过内容时不静默覆盖，先确认一次。
 */
export function useImageToPromptAnalysis({ images, value, onApply }: Options) {
  const { message, modal } = useApp();
  const [analyzing, setAnalyzing] = useState(false);
  /**
   * 文本值的同步镜像：分析是异步的，响应回来时要按**最新**输入判断是否提示
   * 覆盖，不能用点击瞬间的闭包值 —— 否则请求期间用户手打的内容会被静默冲掉。
   */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const analyze = useCallback(async () => {
    if (images.length === 0) {
      message.warning('请先上传商品图片');
      return;
    }
    const first = images[0];
    if (!first?.id) {
      message.warning('首张图缺少素材 id，请重新上传后再分析');
      return;
    }
    setAnalyzing(true);
    try {
      const { text } = await promptToolsApi.imageToPrompt(first.id);
      const content = text?.trim();
      if (!content) {
        message.warning('这次没有生成可用内容，请重试');
        return;
      }
      if (valueRef.current.trim()) {
        modal.confirm({
          title: '替换商品描述？',
          content: 'AI 分析会覆盖当前已填写的描述。',
          okText: '替换',
          cancelText: '取消',
          onOk: () => onApply(content),
        });
        return;
      }
      onApply(content);
      message.success('已按首张商品图生成描述，可继续编辑');
    } catch (e) {
      message.error(promptToolErrorMessage(e, 'image'));
    } finally {
      setAnalyzing(false);
    }
  }, [images, message, modal, onApply]);

  return { analyzing, analyze };
}
