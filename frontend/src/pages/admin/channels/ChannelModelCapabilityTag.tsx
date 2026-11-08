import { StatusTag } from '~/admin-ui/primitives';
import { CAPABILITY_OPTIONS } from './constants';

/**
 * 渠道模型能力标签。
 *
 * 复制渠道会生成能力为空的骨架模型，空胶囊无法说明下一步动作；这里与
 * 「请求协议」保持一致，把空能力明确标成待配置。未知非空值保留原文并标黄，
 * 避免新能力或脏数据被误显示成正常状态。
 */
export function ChannelModelCapabilityTag({ capability }: { capability?: string | null }) {
  const value = capability?.trim() ?? '';
  if (!value) {
    return <StatusTag status="capability-unset" tone="warn" label="待配置" />;
  }

  const option = CAPABILITY_OPTIONS.find((item) => item.value === value);
  return (
    <StatusTag
      status={option ? 'capability' : 'capability-unknown'}
      tone={option ? 'brand' : 'warn'}
      label={option?.label ?? value}
    />
  );
}
