import { useMemo, useState } from 'react';
import { Card, Flex, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import type { AdminModelConfig, AdminModelConfigItem, AdminModelRouteRow, Modality } from '../../../types/api';
import type { ModelConfigDraft } from './useModelConfigDraft';
import {
  EFFECTIVE_LABEL,
  EFFECTIVE_TONE,
  MODALITY_LABEL,
  MODALITY_ORDER,
  ROUTE_LABEL,
  ROUTE_OPTIONS_SHORT,
  tagColor,
} from './meta';

/**
 * 逐能力路由页签（antd Table）。
 *
 * 编辑与生效结果合并在一张表；运行方式用短标签，避免 15 行重复长句。
 */
export function RouteSettingsTab({
  config,
  draftState,
  canWrite,
}: {
  config: AdminModelConfig;
  draftState: ModelConfigDraft;
  canWrite: boolean;
}) {
  const [filter, setFilter] = useState<'all' | Modality>('all');

  const routeItems = useMemo(() => {
    const map = new Map<string, AdminModelConfigItem>();
    for (const g of config.groups) {
      if (g.key !== 'route') continue;
      for (const it of g.items) map.set(it.key.replace('gateway.route.', ''), it);
    }
    return map;
  }, [config]);

  const rows = config.routes.filter((r) => filter === 'all' || r.modality === filter);
  const summary = {
    gateway: rows.filter((r) => r.effective === 'gateway').length,
    none: rows.filter((r) => r.effective === 'none').length,
  };

  const columns = [
    {
      title: '能力',
      key: 'name',
      width: 240,
      render: (_: unknown, r: AdminModelRouteRow) => (
        <Flex vertical gap={0}>
          <Typography.Text strong>{r.name}</Typography.Text>
          <Typography.Text code style={{ fontSize: 11 }}>
            {r.capability}
          </Typography.Text>
        </Flex>
      ),
    },
    ...(filter === 'all'
      ? [
          {
            title: '产出模态',
            key: 'modality',
            width: 100,
            render: (_: unknown, r: AdminModelRouteRow) => MODALITY_LABEL[r.modality],
          },
        ]
      : []),
    {
      title: '实现程度',
      key: 'mode',
      width: 110,
      render: (_: unknown, r: AdminModelRouteRow) =>
        r.mode === 'real' ? (
          <Tag color="success" variant="filled">
            已接入
          </Tag>
        ) : (
          <Tag variant="filled">规划中</Tag>
        ),
    },
    {
      title: '运行方式',
      key: 'route',
      width: 220,
      render: (_: unknown, r: AdminModelRouteRow) => {
        const item = routeItems.get(r.capability);
        if (!item) return ROUTE_LABEL[r.route] ?? r.route;
        const locked = item.source === 'env';
        const value = draftState.clears[item.key]
          ? 'auto'
          : (draftState.draft[item.key] ?? item.value ?? 'auto');
        /*
         * 新配置只允许 auto / remote。存量 local 不能静默改写，
         * 但必须显式显示为「已停用」并引导运营选择自动或仅远程。
         */
        const legacyLocal = String(value) === 'local';
        const options = legacyLocal
          ? [
              {
                value: 'local',
                label: '存量本地（已停用）',
                title: '本地生成已删除；保持此项会使能力不可提交，请改为自动或仅远程',
                disabled: true,
              },
              ...ROUTE_OPTIONS_SHORT,
            ]
          : ROUTE_OPTIONS_SHORT;
        return (
          <Space size={6} wrap>
            <Select
              size="small"
              style={{ width: 110 }}
              value={String(value)}
              disabled={!canWrite || locked}
              onChange={(v) => draftState.setValue(item.key, v)}
              options={options}
            />
            {locked && (
              <Tag color="error" variant="filled">
                环境变量
              </Tag>
            )}
            {legacyLocal && !locked && (
              <Tag color="error" variant="filled">
                请改为自动/仅远程
              </Tag>
            )}
            {draftState.clears[item.key] && (
              <Tag color="warning" variant="filled">
                保存后恢复默认
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '实际生效',
      key: 'effective',
      width: 170,
      render: (_: unknown, r: AdminModelRouteRow) => (
        <Tag color={tagColor(EFFECTIVE_TONE[r.effective])} variant="filled">
          {EFFECTIVE_LABEL[r.effective]}
        </Tag>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space size={8} wrap>
          <Typography.Text strong>逐能力路由</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            按能力 id 全局唯一；所有模态只允许模型通道，存量「仅本地」需改为自动或仅远程。
          </Typography.Text>
        </Space>
      }
      extra={
        <Flex align="center" gap={16} wrap>
          <Space size={12}>
            <Typography.Text type="success" style={{ fontSize: 12 }}>
              ● {summary.gateway} 真实模型
            </Typography.Text>
            {summary.none > 0 && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                ● {summary.none} 需配置模型
              </Typography.Text>
            )}
          </Space>
          <Segmented<'all' | Modality>
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { label: '全部', value: 'all' },
              ...MODALITY_ORDER.map((m) => ({ label: MODALITY_LABEL[m], value: m })),
            ]}
          />
        </Flex>
      }
    >
      <Table<AdminModelRouteRow>
        rowKey="capability"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 840 }}
      />
    </Card>
  );
}
