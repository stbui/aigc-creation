import { Alert, Card, Flex, Statistic, Tag, Typography } from 'antd';
import type { AdminModelChannelSnapshot, Modality } from '../../../types/api';
import {
  DISPATCH_SOURCE_META,
  EFFECTIVE_LABEL,
  EFFECTIVE_TONE,
  MODALITY_EMPTY_HINT,
  MODALITY_LABEL,
  tagColor,
} from './meta';

/**
 * 模态健康卡 —— 首屏「一屏看清三个模态」的入口。
 *
 * 既是总览也是筛选器：状态、线路数、可用数、冷却数、调度来源都在一屏内。
 */
export function ChannelHealthCard({
  modality,
  snapshot,
  active,
  onClick,
}: {
  modality: Modality;
  snapshot?: AdminModelChannelSnapshot;
  active: boolean;
  onClick: () => void;
}) {
  const source = snapshot?.source ?? 'none';
  const available = snapshot?.availableCount ?? 0;
  const effective = available > 0 ? 'gateway' : 'none';
  const dispatch = DISPATCH_SOURCE_META[source];
  const total = snapshot?.total ?? 0;
  const cooling = snapshot?.coolingCount ?? 0;
  const unsupported = snapshot?.unsupportedCount ?? 0;

  return (
    <Card
      hoverable
      size="small"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`筛选${MODALITY_LABEL[modality]}线路`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        height: '100%',
        cursor: 'pointer',
        borderColor: active ? 'var(--brand)' : undefined,
        boxShadow: active ? '0 0 0 1px var(--brand)' : undefined,
      }}
      styles={{ body: { padding: 16 } }}
    >
      <Flex justify="space-between" align="center" gap={8}>
        <Typography.Text strong>{MODALITY_LABEL[modality]}</Typography.Text>
        <Tag color={tagColor(EFFECTIVE_TONE[effective])} variant="filled">
          {EFFECTIVE_LABEL[effective]}
        </Tag>
      </Flex>

      <Flex gap={24} style={{ margin: '14px 0 12px' }}>
        <Statistic title="线路" value={total} styles={{ title: { fontSize: 12 }, content: { fontSize: 20 } }} />
        <Statistic title="可用" value={available} styles={{ title: { fontSize: 12 }, content: { fontSize: 20 } }} />
        <Statistic title="冷却" value={cooling} styles={{ title: { fontSize: 12 }, content: { fontSize: 20 } }} />
      </Flex>

      {source !== 'none' && (
        <Flex justify="space-between" align="center" gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            调度来源
          </Typography.Text>
          <Tag color={tagColor(dispatch.tone)} variant="filled">
            {dispatch.label}
          </Tag>
        </Flex>
      )}

      {(cooling > 0 || unsupported > 0) && (
        <Alert
          style={{ marginTop: 10, fontSize: 12 }}
          type="warning"
          showIcon
          title={`${cooling > 0 ? `${cooling} 条冷却中；` : ''}${
            unsupported > 0 ? `${unsupported} 条协议未接入；` : ''
          }调度会自动跳过不可用线路。`}
        />
      )}

      {source === 'none' && (
        <Alert
          style={{ marginTop: 10, fontSize: 12 }}
          type={modality === 'image' ? 'warning' : 'error'}
          showIcon
          title={MODALITY_EMPTY_HINT[modality]}
        />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        {active ? '正在查看该模态' : '点击筛选该模态'}
      </Typography.Text>
    </Card>
  );
}
