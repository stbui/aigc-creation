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
    local: rows.filter((r) => r.effective === 'local').length,
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
         * 本地没有实现的能力 (创意生图 / 局部重绘 / 图片翻译 / 自由创作,
         * 以及文本/视频) 不能选「仅本地」—— 那是必然 42204 的组合。
         * 后端 updateAll 会拒, 这里置灰是为了让人当场看懂原因, 而不是
         * 点保存后才收到一句报错。
         *
         * 判据写成 `!== false` 而不是直接取反: 字段缺位 (前端先于后端上线、
         * 或读到旧缓存) 时按「可本地」处理, 免得把 15 项能力全标成
         * 「无本地实现」并锁死选项 —— 那才是更贵的误报。
         */
        const localAvailable = r.localAvailable !== false;
        const options: Array<{ value: string; label: string; title?: string; disabled?: boolean }> =
          localAvailable
            ? ROUTE_OPTIONS_SHORT
            : ROUTE_OPTIONS_SHORT.map((o) =>
                o.value === 'local'
                  ? { ...o, disabled: true, title: '该能力本地没有实现，选此项会直接失败' }
                  : o,
              );
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
            {!localAvailable && (
              <Tag variant="filled">无本地实现</Tag>
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
            按能力 id 全局唯一；图像可回落本地，文生文/视频没有本地兜底。
          </Typography.Text>
        </Space>
      }
      extra={
        <Flex align="center" gap={16} wrap>
          <Space size={12}>
            <Typography.Text type="success" style={{ fontSize: 12 }}>
              ● {summary.gateway} 真实模型
            </Typography.Text>
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              ● {summary.local} 本地算法
            </Typography.Text>
            {summary.none > 0 && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                ● {summary.none} 无兜底
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
