import { useCallback, useState } from 'react';
import { App } from 'antd';
import { generateApi } from '../lib/api';
import { useProject } from './useProject';
import { useTaskPoller, type ToolAsset, type ToolResult } from '../components/ToolShell';

interface UseToolTaskOptions {
  /** 能力 id (与后端 capability.registry 一致) */
  capability: string;
  /** 成功提示文案 */
  successMessage: string;
  /** 触发提交所需的最少输入图数量, 默认 1 */
  minInputs?: number;
}

/**
 * 单图工具任务的提交/轮询/状态封装。
 *
 * 修图系 8 个工具页 (抠图/扩图/换色/翻译/去水印/精修/旋转/局部重绘) 此前各自
 * 复制粘贴同一段 "ensureProject → start → poll → 设置结果 → message" 逻辑;
 * 这里收口为唯一实现, 页面只负责拼 params。
 *
 * 多任务/多结果页面 (商品主图/详情图/SKU/多图融合/自由创作/爆款复刻) 结构不同,
 * 仍各自维护提交流程, 不复用此 hook。
 */
export function useToolTask({ capability, successMessage, minInputs = 1 }: UseToolTaskOptions) {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const poll = useTaskPoller();

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  const run = useCallback(
    async (inputs: ToolAsset[], params: Record<string, unknown>) => {
      if (inputs.length < minInputs) return;
      setSubmitting(true);
      setResult(null);
      try {
        const projectId = await ensureProject();
        const { taskId } = await generateApi.start({
          projectId,
          capability,
          inputAssetIds: inputs.map((i) => i.id),
          params,
        });
        const done = await poll(taskId);
        setResult(done);
        if (done.status === 'failed') {
          message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
        } else {
          message.success(successMessage);
        }
      } catch (e) {
        message.error((e as Error).message || '生成失败');
      } finally {
        setSubmitting(false);
      }
    },
    [capability, successMessage, minInputs, ensureProject, message, poll],
  );

  return { submitting, result, setResult, run };
}
