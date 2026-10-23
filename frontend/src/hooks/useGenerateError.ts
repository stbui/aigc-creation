import { App } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';

/**
 * 生成任务提交失败的统一出口。
 *
 * 402 = 积分不足（后端 `generate.service` 转的 40201）。刻意给「去充值」的
 * 行动入口而不是干巴巴一句报错 —— 用户看到「积分不足: 需要 10, 可用 3」时
 * 不知道下一步做什么，只告知不给出路是最容易催生客服工单的交互。
 *
 * 收口成一个 hook：多任务页面（主图/详情/SKU/融合/自由创作/复刻）各自维护
 * 提交流程，但「失败之后该显示什么」必须全站一致。
 */
export function useGenerateError(): (e: unknown) => void {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();

  return (e: unknown) => {
    if (e instanceof ApiError && e.status === 402) {
      modal.confirm({
        title: '积分不足',
        content: `${e.message}。充值后可继续生成。`,
        okText: '去充值',
        cancelText: '知道了',
        onOk: () => navigate('/packages'),
      });
      return;
    }
    message.error((e as Error)?.message || '生成失败');
  };
}
