import { useCallback, useState } from 'react';
import { App } from 'antd';
import { generateApi, ApiError } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { useProject } from './useProject';
import { useTaskPoller, type ToolAsset, type ToolResult } from '../components/ToolShell';
import { notifyCreditsChanged } from '../context/CreditsContext';

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
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
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
        /*
         * 402 = 积分不足 (后端 generate.service 转的 40201)。
         *
         * 刻意给「去充值」的行动入口而不是干巴巴一句报错 ——
         * 用户看到「积分不足: 需要 10, 可用 3」时不知道下一步做什么,
         * 只告知不给出路是最容易催生客服工单的交互。
         */
        if (e instanceof ApiError && e.status === 402) {
          modal.confirm({
            title: '积分不足',
            content: `${e.message}。充值后可继续生成。`,
            okText: '去充值',
            cancelText: '知道了',
            onOk: () => navigate('/packages'),
          });
        } else {
          message.error((e as Error).message || '生成失败');
        }
      } finally {
        setSubmitting(false);
        /*
         * 无论成功失败都要刷新余额。
         *
         * 扣费发生在**建任务时**而非成功时, 而失败时后端会自动退还 ——
         * 两个方向都改变了余额。放在 finally 里是刻意的:
         * 只在成功分支刷新会让用户「失败之后余额还是扣掉的数字」,
         * 看起来像吞了积分。
         */
        notifyCreditsChanged();
      }
    },
    [capability, successMessage, minInputs, ensureProject, message, poll],
  );

  return { submitting, result, setResult, run };
}
